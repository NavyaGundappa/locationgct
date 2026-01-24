const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(helmet({
    contentSecurityPolicy: false, // Adjust based on your needs
    crossOriginEmbedderPolicy: false
}));

app.use(compression());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // limit each IP to 1000 requests per windowMs
});
app.use('/api/', limiter);

const allowedOrigins =
    process.env.NODE_ENV === 'production'
        ? ['https://api.greenchilliestechnology.com']
        : ['http://localhost:3000'];

// CORS configuration
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

const morgan = require('morgan');
app.use(morgan('combined'));

app.use(bodyParser.json());

// AWS Configuration
AWS.config.update({
    region: process.env.AWS_REGION || 'us-north-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

// Tables
const EMPLOYEES_TABLE = 'Employees';
const LOCATION_TABLE = 'EmployeeLocation';
const ATTENDANCE_TABLE = 'EmployeeAttendance';

// Helper function to format date
const formatDate = (date) => {
    return date.toISOString().split('T')[0];
};

// Helper function to format time
const formatTime = (date) => {
    return date.toISOString().split('T')[1].split('.')[0].substr(0, 8);
};

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        status: 'online'
    });
});

// 1. EMPLOYEE MANAGEMENT ENDPOINTS

// Add new employee
app.post('/api/employees', async (req, res) => {
    try {
        const { employeeId, name, email, phone, department, deviceId, password } = req.body;

        if (!employeeId || !name) {
            return res.status(400).json({ error: 'Employee ID and Name are required' });
        }

        const now = new Date();

        // Store plain password (default is "12345")
        const employeePassword = password || '12345'; // Plain password

        const params = {
            TableName: EMPLOYEES_TABLE,
            Item: {
                employeeId,
                name,
                email: email || '',
                phone: phone || '',
                department: department || '',
                deviceId: deviceId || `DEVICE_${employeeId}`,
                password: employeePassword, // Store plain password
                passwordSet: false, // Flag to indicate if password was changed by user
                status: 'inactive',
                createdAt: now.toISOString(),
                lastUpdated: now.toISOString(),
                isActive: true
            },
            ConditionExpression: 'attribute_not_exists(employeeId)'
        };

        await dynamodb.put(params).promise();
        res.json({
            success: true,
            message: 'Employee added successfully',
            employee: {
                ...params.Item,
                password: undefined // Don't send password back in response
            }
        });
    } catch (error) {
        console.error('Error adding employee:', error);
        if (error.code === 'ConditionalCheckFailedException') {
            res.status(400).json({ error: 'Employee ID already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Update password endpoint
app.put('/api/employees/:employeeId/password', async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const { employeeId } = req.params;

        if (!newPassword) {
            return res.status(400).json({ error: 'New password is required' });
        }

        // Get employee
        const getParams = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId }
        };

        const employee = await dynamodb.get(getParams).promise();

        if (!employee.Item) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Verify old password if passwordSet is true
        if (employee.Item.passwordSet) {
            if (!oldPassword) {
                return res.status(400).json({ error: 'Old password is required' });
            }

            if (oldPassword !== employee.Item.password) {
                return res.status(401).json({ error: 'Old password is incorrect' });
            }
        }

        // Store plain password
        const updateParams = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId },
            UpdateExpression: 'SET password = :password, passwordSet = :passwordSet, lastUpdated = :updated',
            ExpressionAttributeValues: {
                ':password': newPassword, // Plain password
                ':passwordSet': true,
                ':updated': new Date().toISOString()
            }
        };

        await dynamodb.update(updateParams).promise();

        res.json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get all employees
app.get('/api/employees', async (req, res) => {
    try {
        const params = {
            TableName: EMPLOYEES_TABLE
        };

        const result = await dynamodb.scan(params).promise();
        res.json(result.Items || []);
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single employee
app.get('/api/employees/:employeeId', async (req, res) => {
    try {
        const params = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId: req.params.employeeId }
        };

        const result = await dynamodb.get(params).promise();
        if (result.Item) {
            res.json(result.Item);
        } else {
            res.status(404).json({ error: 'Employee not found' });
        }
    } catch (error) {
        console.error('Error fetching employee:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { employeeId, password } = req.body;

        if (!employeeId || !password) {
            return res.status(400).json({ error: 'Employee ID and password are required' });
        }

        const params = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId }
        };

        const result = await dynamodb.get(params).promise();

        if (!result.Item) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password directly since they are stored as plain text
        if (password !== result.Item.password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Remove password from response
        const { password: _, ...employeeData } = result.Item;

        res.json({
            success: true,
            message: 'Login successful',
            employee: employeeData,
            requiresPasswordChange: !result.Item.passwordSet
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. LOCATION TRACKING ENDPOINTS

// Record location update
app.post('/api/locations', async (req, res) => {
    try {
        const { employeeId, deviceId, latitude, longitude, speed, accuracy, battery, timestamp } = req.body;

        if (!employeeId || !latitude || !longitude) {
            return res.status(400).json({ error: 'Employee ID, latitude and longitude are required' });
        }

        const now = new Date();
        const locationId = `${employeeId}_${now.getTime()}`;
        const recordTime = timestamp || now.toISOString();

        const params = {
            TableName: LOCATION_TABLE,
            Item: {
                locationId,
                employeeId,
                deviceId: deviceId || `DEVICE_${employeeId}`,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                speed: speed ? parseFloat(speed) : 0,
                accuracy: accuracy ? parseFloat(accuracy) : 0,
                battery: battery ? parseFloat(battery) : 100,
                timestamp: recordTime,
                date: formatDate(new Date(recordTime)),
                time: formatTime(new Date(recordTime))
            }
        };

        await dynamodb.put(params).promise();

        // Update employee's last location
        const updateParams = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId },
            UpdateExpression: 'SET lastLocationTime = :time, lastLatitude = :lat, lastLongitude = :lng, #s = :status, lastUpdated = :updated',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':time': recordTime,
                ':lat': parseFloat(latitude),
                ':lng': parseFloat(longitude),
                ':status': 'active',
                ':updated': now.toISOString()
            }
        };

        await dynamodb.update(updateParams).promise();

        res.json({
            success: true,
            message: 'Location recorded',
            location: params.Item
        });
    } catch (error) {
        console.error('Error recording location:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all locations with filters
app.get('/api/locations', async (req, res) => {
    try {
        const { employeeId, deviceId, date, startDate, endDate, limit = 100 } = req.query;

        let params = {
            TableName: LOCATION_TABLE,
            Limit: parseInt(limit)
        };

        let filterExpressions = [];
        let expressionAttributeValues = {};

        if (employeeId) {
            filterExpressions.push('employeeId = :employeeId');
            expressionAttributeValues[':employeeId'] = employeeId;
        }

        if (deviceId) {
            filterExpressions.push('deviceId = :deviceId');
            expressionAttributeValues[':deviceId'] = deviceId;
        }

        if (date) {
            filterExpressions.push('#d = :date');
            expressionAttributeValues[':date'] = date;
        }

        if (filterExpressions.length > 0) {
            params.FilterExpression = filterExpressions.join(' AND ');
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        // Add ExpressionAttributeNames for reserved keywords
        if (date) {
            params.ExpressionAttributeNames = { '#d': 'date' };
        }

        const result = await dynamodb.scan(params).promise();

        // Apply date range filter if provided
        let locations = result.Items || [];
        if (startDate && endDate) {
            locations = locations.filter(item => {
                const itemDate = new Date(item.timestamp);
                return itemDate >= new Date(startDate) && itemDate <= new Date(endDate);
            });
        }

        // Sort by timestamp descending (latest first)
        locations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(locations);
    } catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get latest locations (one per employee/device)
app.get('/api/locations/latest', async (req, res) => {
    try {
        const params = {
            TableName: LOCATION_TABLE
        };

        const result = await dynamodb.scan(params).promise();
        const locations = result.Items || [];

        // Group by employeeId and get latest
        const latestLocations = {};
        locations.forEach(location => {
            if (!latestLocations[location.employeeId] ||
                new Date(location.timestamp) > new Date(latestLocations[location.employeeId].timestamp)) {
                latestLocations[location.employeeId] = location;
            }
        });

        const latestArray = Object.values(latestLocations);
        latestArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(latestArray);
    } catch (error) {
        console.error('Error fetching latest locations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get location history for specific employee
app.get('/api/employees/:employeeId/locations', async (req, res) => {
    try {
        const { startDate, endDate, limit = 50 } = req.query;

        const params = {
            TableName: LOCATION_TABLE,
            FilterExpression: 'employeeId = :employeeId',
            ExpressionAttributeValues: {
                ':employeeId': req.params.employeeId
            },
            Limit: parseInt(limit)
        };

        const result = await dynamodb.scan(params).promise();
        let locations = result.Items || [];

        // Sort by timestamp descending
        locations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(locations);
    } catch (error) {
        console.error('Error fetching employee locations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Seed test data
app.post('/api/seed-test-data', async (req, res) => {
    try {
        const now = new Date();

        const testEmployees = [
            {
                employeeId: 'EMP001',
                name: 'John Smith',
                email: 'john@company.com',
                phone: '+1234567890',
                department: 'Sales',
                deviceId: 'GPS_TRACKER_001',
                status: 'active',
                createdAt: now.toISOString(),
                lastUpdated: now.toISOString(),
                isActive: true
            },
            {
                employeeId: 'EMP002',
                name: 'Sarah Johnson',
                email: 'sarah@company.com',
                phone: '+1987654321',
                department: 'Marketing',
                deviceId: 'GPS_TRACKER_002',
                status: 'active',
                createdAt: now.toISOString(),
                lastUpdated: now.toISOString(),
                isActive: true
            }
        ];

        const testLocations = [
            {
                locationId: `EMP001_${now.getTime()}`,
                employeeId: 'EMP001',
                deviceId: 'GPS_TRACKER_001',
                latitude: 40.7128,
                longitude: -74.0060,
                speed: 25.5,
                accuracy: 10,
                battery: 85,
                timestamp: now.toISOString(),
                date: formatDate(now),
                time: formatTime(now)
            },
            {
                locationId: `EMP002_${now.getTime() + 1000}`,
                employeeId: 'EMP002',
                deviceId: 'GPS_TRACKER_002',
                latitude: 34.0522,
                longitude: -118.2437,
                speed: 18.2,
                accuracy: 15,
                battery: 92,
                timestamp: now.toISOString(),
                date: formatDate(now),
                time: formatTime(now)
            }
        ];

        // Insert test employees
        for (const employee of testEmployees) {
            await dynamodb.put({
                TableName: EMPLOYEES_TABLE,
                Item: employee
            }).promise();
        }

        // Insert test locations
        for (const location of testLocations) {
            await dynamodb.put({
                TableName: LOCATION_TABLE,
                Item: location
            }).promise();
        }

        res.json({
            success: true,
            message: 'Test data seeded successfully',
            employees: testEmployees.length,
            locations: testLocations.length
        });
    } catch (error) {
        console.error('Error seeding test data:', error);
        res.status(500).json({ error: error.message });
    }
});


// Create attendance record endpoint
app.post('/api/attendance', async (req, res) => {
    try {
        const { employeeId, status, timestamp } = req.body;

        if (!employeeId || !status) {
            return res.status(400).json({ error: 'Employee ID and status are required' });
        }

        const now = new Date();
        const attendanceId = `${employeeId}_${now.getTime()}`;
        const recordTime = timestamp || now.toISOString();

        const params = {
            TableName: ATTENDANCE_TABLE,
            Item: {
                attendanceId,
                employeeId,
                status, // 'clock_in' or 'clock_out'
                timestamp: recordTime,
                date: formatDate(new Date(recordTime)),
                time: formatTime(new Date(recordTime))
            }
        };

        await dynamodb.put(params).promise();

        // Update employee status
        const updateParams = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId },
            UpdateExpression: 'SET #s = :status, lastUpdated = :updated',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':status': status === 'clock_in' ? 'active' : 'inactive',
                ':updated': now.toISOString()
            }
        };

        await dynamodb.update(updateParams).promise();

        res.json({
            success: true,
            message: `Attendance ${status} recorded`
        });
    } catch (error) {
        console.error('Error recording attendance:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Employee Location Tracker API'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);

    // Log to file in production
    if (process.env.NODE_ENV === 'production') {
        const fs = require('fs');
        fs.appendFileSync('error.log', `${new Date().toISOString()} - ${err.stack}\n`);
    }

    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Something went wrong!'
            : err.message
    });
});

// Only serve API routes, not static files
app.get('/api', (req, res) => {
  res.json({
    message: 'API Server is running',
    timestamp: new Date().toISOString(),
    status: 'online',
    endpoints: ['/api/test', '/api/users'] // Add your actual endpoints
  });
});


// Start server
app.listen(port, () => {
    console.log('========================================');
    console.log('Employee Location Tracker API');
    console.log('========================================');
    console.log(`Server running on port ${port}`);
    console.log(`Internal: http://localhost:${port}`);
    console.log(`API via Nginx: https://api.greenchilliestechnology.com/api`);
    console.log('========================================');
});
