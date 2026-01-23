const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const AWS = require('aws-sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// AWS DynamoDB configuration
AWS.config.update({
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || 'LocationData';

// Middleware
app.use(helmet());
app.use(cors({
    origin: ['https://greenchilliestechnology.com', 'https://api.greenchilliestechnology.com'],
    credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Store location data
app.post('/api/location', async (req, res) => {
    try {
        const locationData = req.body;

        // Validate required fields
        if (!locationData.latitude || !locationData.longitude || !locationData.device_id) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const params = {
            TableName: TABLE_NAME,
            Item: {
                location_id: `${locationData.device_id}_${Date.now()}`,
                device_id: locationData.device_id,
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                accuracy: locationData.accuracy || null,
                altitude: locationData.altitude || null,
                speed: locationData.speed || null,
                speed_accuracy: locationData.speed_accuracy || null,
                heading: locationData.heading || null,
                timestamp: locationData.timestamp || new Date().toISOString(),
                created_at: new Date().toISOString()
            }
        };

        await dynamoDB.put(params).promise();

        res.json({
            success: true,
            message: 'Location data stored successfully',
            location_id: params.Item.location_id
        });
    } catch (error) {
        console.error('Error storing location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all locations for a device
app.get('/api/locations/:device_id', async (req, res) => {
    try {
        const { device_id } = req.params;
        const { start_date, end_date, limit = 100 } = req.query;

        let params = {
            TableName: TABLE_NAME,
            KeyConditionExpression: 'device_id = :device_id',
            ExpressionAttributeValues: {
                ':device_id': device_id
            },
            ScanIndexForward: false, // Descending order (newest first)
            Limit: parseInt(limit)
        };

        // Add time filter if provided
        if (start_date && end_date) {
            params.KeyConditionExpression += ' AND #timestamp BETWEEN :start AND :end';
            params.ExpressionAttributeNames = {
                '#timestamp': 'timestamp'
            };
            params.ExpressionAttributeValues[':start'] = start_date;
            params.ExpressionAttributeValues[':end'] = end_date;
        }

        const result = await dynamoDB.query(params).promise();

        res.json({
            success: true,
            count: result.Count,
            data: result.Items
        });
    } catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get latest location for all devices
app.get('/api/locations', async (req, res) => {
    try {
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'device_id-created_at-index', // You need to create this GSI
            KeyConditionExpression: 'device_id = :device_id',
            ExpressionAttributeValues: {
                ':device_id': 'all' // This is a placeholder - adjust based on your needs
            },
            ScanIndexForward: false,
            Limit: 50
        };

        const result = await dynamoDB.query(params).promise();

        res.json({
            success: true,
            data: result.Items
        });
    } catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
});