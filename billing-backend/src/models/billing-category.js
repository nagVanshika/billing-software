const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    type: {
        type: String,
        enum: ['expense', 'collection', 'both'],
        default: 'expense',
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active',
        index: true
    }
}, {
    timestamps: true
});

const BillingCategory = mongoose.model('BillingCategory', categorySchema, 'billing-category');

module.exports = BillingCategory;