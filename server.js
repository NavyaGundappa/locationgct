const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// ==========================================
// 1. HELPER FUNCTIONS (Moved to top to prevent crashes)
// ==========================================

const getISTTimestamp = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.toISOString().replace('T', ' ').substring(0, 19);
};

const getISTDateString = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    return istDate.toISOString().split('T')[0];
};

const getTodayDateString = getISTDateString;
// Define this alias so it works everywhere

const formatDate = (dateString) => {
    const date = new Date(dateString);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatTime = (dateString) => {
    const date = new Date(dateString);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
};

// ==========================================
// 2. MIDDLEWARE & CONFIG
// ==========================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000
});
app.use('/api/', limiter);

const allowedOrigins = [
    'https://greenchilliestechnology.com',
    'https://api.greenchilliestechnology.com',
    'http://localhost:3000',
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, true); // Permissive for dev/mobile
    },
    credentials: true,
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
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'Employees';
const LOCATION_TABLE = process.env.LOCATION_TABLE || 'EmployeeLocation';
const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE || 'Attendance';

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        status: 'online'
    });
});

// ==========================================
// 3. EMPLOYEE MANAGEMENT ENDPOINTS
// ==========================================

// Add new employee
app.post('/api/employees', async (req, res) => {
    try {
        const { employeeId, name, email, phone, department, deviceId, password, role } = req.body;

        if (!employeeId || !name) {
            return res.status(400).json({ error: 'Employee ID and Name are required' });
        }

        const now = new Date();
        const employeePassword = password || '12345';

        const params = {
            TableName: EMPLOYEES_TABLE,
            Item: {
                employeeId,
                name,
                email: email || '',
                phone: phone || '',
                department: department || '',
                role: role || 'employee',
                deviceId: deviceId || `DEVICE_${employeeId}`,
                password: employeePassword,
                passwordSet: false,
                status: 'active',
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
            employee: { ...params.Item, password: undefined }
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

        if (!newPassword) return res.status(400).json({ error: 'New password is required' });

        const getParams = { TableName: EMPLOYEES_TABLE, Key: { employeeId } };
        const employee = await dynamodb.get(getParams).promise();

        if (!employee.Item) return res.status(404).json({ error: 'Employee not found' });

        if (employee.Item.passwordSet) {
            if (!oldPassword) return res.status(400).json({ error: 'Old password is required' });
            if (oldPassword !== employee.Item.password) return res.status(401).json({ error: 'Old password is incorrect' });
        }

        const updateParams = {
            TableName: EMPLOYEES_TABLE,
            Key: { employeeId },
            UpdateExpression: 'SET password = :password, passwordSet = :passwordSet, lastUpdated = :updated',
            ExpressionAttributeValues: {
                ':password': newPassword,
                ':passwordSet': true,
                ':updated': new Date().toISOString()
            }
        };

        await dynamodb.update(updateParams).promise();
        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all employees
app.get('/api/employees', async (req, res) => {
    try {
        const result = await dynamodb.scan({ TableName: EMPLOYEES_TABLE }).promise();
        res.json(result.Items || []);
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single employee
app.get('/api/employees/:employeeId', async (req, res) => {
    try {
        const params = { TableName: EMPLOYEES_TABLE, Key: { employeeId: req.params.employeeId } };
        const result = await dynamodb.get(params).promise();
        if (result.Item) res.json(result.Item);
        else res.status(404).json({ error: 'Employee not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { employeeId, password } = req.body;
        if (!employeeId || !password) return res.status(400).json({ error: 'Employee ID and password are required' });

        const params = { TableName: EMPLOYEES_TABLE, Key: { employeeId } };
        const result = await dynamodb.get(params).promise();

        if (!result.Item || password !== result.Item.password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const { password: _, ...employeeData } = result.Item;
        res.json({
            success: true,
            message: 'Login successful',
            employee: employeeData,
            requiresPasswordChange: !result.Item.passwordSet
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 4. LOCATION TRACKING ENDPOINTS (FIXED)
// ==========================================

// Record location (CONSOLIDATED ENDPOINT - NO DUPLICATES)
app.post('/api/locations', async (req, res) => {
    console.log("📍 LOCATION REQUEST RECEIVED:", req.body);

    try {
        const { employeeId, latitude, longitude, speed, accuracy } = req.body;

        if (!employeeId || !latitude || !longitude) {
            console.log("❌ Missing Data:", req.body);
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const now = new Date();
        const timestamp = now.getTime();
        // Uses the hoisted helper function safely
        const dateStr = getTodayDateString();

        const params = {
            TableName: LOCATION_TABLE,
            Item: {
                'locationId': `${employeeId}_${timestamp}`,
                'employeeId': employeeId,
                'latitude': parseFloat(latitude),
                'longitude': parseFloat(longitude),
                'speed': speed || 0,
                'accuracy': accuracy || 0,
                'recordedAt': now.toISOString(),
                'date': dateStr,
                'timestamp': timestamp.toString()
            }
        };

        await dynamodb.put(params).promise();
        console.log(`✅ Location Saved: ${employeeId}`);
        res.json({ success: true });

    } catch (error) {
        console.error('❌ CRITICAL DB ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get latest locations (one per employee)
app.get('/api/locations/latest', async (req, res) => {
    try {
        const result = await dynamodb.scan({ TableName: LOCATION_TABLE }).promise();
        const locations = result.Items || [];

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
        res.status(500).json({ error: error.message });
    }
});

// server.js - New endpoint for daily historical logs
app.get('/api/locations/history/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { date } = req.query; // Expecting YYYY-MM-DD

        if (!employeeId || !date) {
            return res.status(400).json({ error: 'Employee ID and Date are required' });
        }

        const params = {
            TableName: 'EmployeeLocation',
            FilterExpression: 'employeeId = :eid AND #d = :date',
            ExpressionAttributeNames: {
                '#d': 'date'
            },
            ExpressionAttributeValues: {
                ':eid': employeeId,
                ':date': date
            }
        };

        const result = await dynamodb.scan(params).promise();

        // Sort by recordedAt to ensure the polyline follows the path correctly
        const sortedLogs = (result.Items || []).sort((a, b) =>
            new Date(a.recordedAt) - new Date(b.recordedAt)
        );

        res.json(sortedLogs);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get location history for specific employee
app.get('/api/employees/:employeeId/locations', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const params = {
            TableName: LOCATION_TABLE,
            FilterExpression: 'employeeId = :employeeId',
            ExpressionAttributeValues: { ':employeeId': req.params.employeeId },
            Limit: parseInt(limit) // Note: Scan limit applies before filtering in DynamoDB, for full accuracy query with GSI is better but Scan works for small data
        };

        const result = await dynamodb.scan(params).promise();
        let locations = result.Items || [];
        locations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(locations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const today = getISTDateString(); // "2026-01-31"

        // 1. Fetch Total Employees
        const employeesResult = await dynamodb.scan({
            TableName: EMPLOYEES_TABLE,
            Select: 'COUNT'
        }).promise();
        const totalEmployees = employeesResult.Count || 0;

        // 2. Fetch Today's Attendance
        const attendanceResult = await dynamodb.scan({
            TableName: ATTENDANCE_TABLE,
            FilterExpression: '#d = :today',
            ExpressionAttributeNames: { '#d': 'date' },
            ExpressionAttributeValues: { ':today': today }
        }).promise();

        const attendanceRecords = attendanceResult.Items || [];

        // 3. Calculate Stats
        const presentToday = attendanceRecords.length;

        // ACTIVE NOW LOGIC:
        // Includes anyone who has clocked in today but does NOT have a clockOutTime yet.
        const activeNow = attendanceRecords.filter(record => {
            // Check if clockInTime exists and clockOutTime is null, undefined, or empty string
            return record.clockInTime && (!record.clockOutTime || record.clockOutTime === "");
        }).length;

        res.json({
            success: true,
            stats: {
                employees: totalEmployees.toString(),
                present: presentToday.toString(),
                active: activeNow.toString(),
                leave_pending: "0" // Placeholder
            }
        });

    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 5. ATTENDANCE ENDPOINTS
// ==========================================

// CLOCK IN
app.post('/api/attendance/clockin', async (req, res) => {
    try {
        const { employeeId } = req.body;
        const dateStr = getISTDateString();
        const attendanceId = `${employeeId}_${dateStr}`;

        const params = {
            TableName: ATTENDANCE_TABLE,
            Item: {
                attendanceId: attendanceId,
                employeeId: employeeId,
                clockInTime: getISTTimestamp(),
                status: 'completed',
                date: dateStr
            },
            ConditionExpression: 'attribute_not_exists(attendanceId)'
        };

        await dynamodb.put(params).promise();
        res.json({ success: true, message: 'Clocked in successfully', time: params.Item.clockInTime });
    } catch (error) {
        if (error.code === 'ConditionalCheckFailedException') {
            return res.status(400).json({ error: 'Already clocked in for today.' });
        }
        res.status(500).json({ error: error.message });
    }
});

// CLOCK OUT (FIXED)
app.post('/api/attendance/clockout', async (req, res) => {
    try {
        const { employeeId } = req.body;
        const todayStr = getISTDateString(); // "2026-01-31"
        console.log(`🕒 Clock-out request for: ${employeeId}`);

        // 1. Find the record for TODAY specifically
        const scanParams = {
            TableName: ATTENDANCE_TABLE,
            FilterExpression: "employeeId = :eid AND #d = :today",
            ExpressionAttributeNames: { "#d": "date" },
            ExpressionAttributeValues: { ":eid": employeeId, ":today": todayStr }
        };

        const result = await dynamodb.scan(scanParams).promise();

        if (!result.Items || result.Items.length === 0) {
            return res.status(404).json({ error: "No attendance record found for today." });
        }

        const session = result.Items[0];
        const istNow = getISTTimestamp();

        // 2. Use the exact keys to update
        const dbKey = {
            'employeeId': session.employeeId,
            'date': session.date
        };

        const updateParams = {
            TableName: ATTENDANCE_TABLE,
            Key: dbKey,
            // 'set clockOutTime = :t' adds the new column
            UpdateExpression: "set clockOutTime = :t, #s = :status",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":t": istNow,
                ":status": "present" // Keeping 'completed' so the app stops tracking
            },
            ReturnValues: "ALL_NEW"
        };

        const updateResult = await dynamodb.update(updateParams).promise();
        console.log("✅ Saved to DynamoDB:", updateResult.Attributes);

        res.json({
            success: true,
            message: 'Clocked out successfully',
            clockOutTime: istNow
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Check Status
app.get('/api/attendance/status/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const scanParams = {
            TableName: ATTENDANCE_TABLE,
            FilterExpression: "employeeId = :eid AND #s = :status",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":eid": employeeId, ":status": "present" }
        };

        const result = await dynamodb.scan(scanParams).promise();
        const isClockedIn = result.Items && result.Items.length > 0;

        res.json({ success: true, isClockedIn, data: isClockedIn ? result.Items[0] : null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ADMIN DASHBOARD STATS
// ==========================================
app.get('/api/admin/stats', async (req, res) => {
    try {
        const today = getISTDateString();

        // 1. Get all employees (active only)
        const employeesResult = await dynamodb.scan({
            TableName: EMPLOYEES_TABLE,
            FilterExpression: 'isActive = :active',
            ExpressionAttributeValues: { ':active': true }
        }).promise();

        const allEmployees = employeesResult.Items || [];
        const totalEmployees = allEmployees.length;

        // 2. Get today's attendance records
        const attendanceResult = await dynamodb.scan({
            TableName: ATTENDANCE_TABLE,
            FilterExpression: '#d = :today',
            ExpressionAttributeNames: { '#d': 'date' },
            ExpressionAttributeValues: { ':today': today }
        }).promise();

        const todayAttendance = attendanceResult.Items || [];

        // 3. Calculate counts
        let presentToday = 0;
        let activeNow = 0;

        todayAttendance.forEach(record => {
            if (record.status && record.status.toLowerCase() === 'present') {
                presentToday++; // Count all present records

                // Count as active if there's clockInTime but NO clockOutTime
                if (record.clockInTime && !record.clockOutTime) {
                    activeNow++;
                }
            }
        });

        // 4. Pending leave (placeholder - add your own logic)
        const pendingLeave = 0;

        res.json({
            success: true,
            stats: {
                employees: totalEmployees.toString(),
                present: presentToday.toString(),
                active: activeNow.toString(),
                leave_pending: pendingLeave.toString()
            }
        });

    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ==========================================
// 6. UTILITIES
// ==========================================

// Seed test data
app.post('/api/seed-test-data', async (req, res) => {
    try {
        const now = new Date();
        const testEmployees = [
            { employeeId: 'EMP001', name: 'John Smith', email: 'john@company.com', status: 'active', isActive: true, password: '12345' },
            { employeeId: 'EMP002', name: 'Sarah Johnson', email: 'sarah@company.com', status: 'active', isActive: true, password: '123' }
        ];

        for (const employee of testEmployees) {
            await dynamodb.put({ TableName: EMPLOYEES_TABLE, Item: employee }).promise();
        }

        res.json({ success: true, message: 'Test data seeded successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Employee Location Tracker API'
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

// Start server
app.listen(port, () => {
    console.log('========================================');
    console.log('Employee Location Tracker API (COMPLETE)');
    console.log(`Server running on port ${port}`);
    console.log('========================================');
});