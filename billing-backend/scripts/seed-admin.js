const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const Admin = require('../src/models/Admin');

async function seedAdmin() {
    try {
        if (!process.env.MONGODB_URI) {
            console.error('Error: MONGODB_URI is not defined in .env file.');
            console.log('Please create a .env file in billing-backend/ with your MONGODB_URI.');
            process.exit(1);
        }

        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected successfully.');

        // Check if any admins already exist
        const adminCount = await Admin.countDocuments();
        if (adminCount > 0) {
            console.log(`Found ${adminCount} existing admin(s). Seeding aborted to prevent duplicates.`);
            mongoose.connection.close();
            process.exit(0);
        }

        console.log('No admins found. Seeding initial admin users...');

        const admins = [
            {
                username: 'admin',
                password: 'admin123',
                name: 'Super Admin',
                role: 'super_admin',
            },
            {
                username: 'readonly',
                password: 'admin123',
                name: 'Read Only Admin',
                role: 'read_only',
            },
        ];

        // The Admin model has a pre-save hook to hash the password
        await Admin.create(admins);

        console.log('Successfully seeded admin users:');
        console.log('1. Username: admin, Password: admin123 (super_admin)');
        console.log('2. Username: readonly, Password: admin123 (read_only)');
        console.log('\nIMPORTANT: Please change these default passwords after logging in.');

        mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error('Seeding error:', err);
        if (mongoose.connection.readyState !== 0) {
            mongoose.connection.close();
        }
        process.exit(1);
    }
}

seedAdmin();


