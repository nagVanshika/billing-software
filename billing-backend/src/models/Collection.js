const mongoose = require('mongoose');
const { Schema } = mongoose;

const collectionSchema = new Schema({
  customerName: {
    type: String,
    required: true
  },
  date: {
    type: String, // YYYY-MM-DD to match Booking logic
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  category: {
    type: Schema.Types.ObjectId,
    ref: 'Category'
  },
  region: {
    type: String,
    default: 'Unknown'
  },
  status: {
    type: String,
    default: 'complete'
  },
  booking_type: {
    type: String,
    default: 'manual'
  },
  notes: String,
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('Collection', collectionSchema, 'billing-collection');
