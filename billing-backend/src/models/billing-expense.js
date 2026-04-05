const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BillingCategory',
        required: true,
        index: true
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    expenseDate: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    paymentMode: {
        type: String,
        required: true
    },
    paidBy: {
        type: String,
        required: true,
        trim: true
    },
    transactionId: {
        type: String,
        trim: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    settled: {
        type: String,
        default: 'No'
    },
    notes: {
        type: String,
        trim: true
    },
    // kept for filter support
    region: {
        type: String,
        index: true
    },
    attachment: {
        type: String,
        trim: true
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

const BillingExpense = mongoose.model('BillingExpense', expenseSchema, 'billing-expense');

module.exports = BillingExpense;