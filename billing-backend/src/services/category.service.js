const Category = require('../models/billing-category');

/**
 * Get all categories (with optional status filter)
 * @param {string} status - 'active' | 'inactive' | 'all' (default 'all')
 */
const getCategories = async (status = 'all', type = 'all') => {
  const query = {};
  if (status !== 'all') query.status = status;
  if (type !== 'all') {
    // If filtering for expense, include 'both'
    // If filtering for collection, include 'both'
    if (type === 'expense' || type === 'collection') {
      query.$or = [{ type }, { type: 'both' }];
    } else {
      query.type = type;
    }
  }
  return Category.find(query).sort({ name: 1 }).lean();
};

/**
 * Create a new category
 */
const createCategory = async ({ name, description, type }) => {
  const category = new Category({ name, description, type });
  return category.save();
};

/**
 * Update an existing category
 */
const updateCategory = async (id, { name, description, type }) => {
  const category = await Category.findByIdAndUpdate(
    id,
    { name, description, type },
    { new: true, runValidators: true }
  );
  if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });
  return category;
};

/**
 * Soft-delete: mark category as inactive
 */
const deleteCategory = async (id) => {
  const category = await Category.findByIdAndUpdate(
    id,
    { status: 'inactive' },
    { new: true }
  );
  if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });
  return category;
};

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };
