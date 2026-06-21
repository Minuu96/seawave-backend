const mongoose = require('mongoose');
const Admin = require('./models/Admin');
const Category = require('./models/Category');
const Product = require('./models/Product');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('MongoDB connected');
    
    // Create Admin
    const adminEmail = 'admin@seawavetoys.com';
    let admin = await Admin.findOne({ email: adminEmail });
    if (!admin) {
      admin = await Admin.create({
        name: 'Seawave Admin',
        email: adminEmail,
        password: 'Admin@123',
        role: 'superadmin',
        isActive: true,
      });
      console.log('Admin created');
    } else {
      console.log('Admin already exists');
    }

    // Create Categories
    const categoryData = [
      { name: 'Activity Boards', description: 'Interactive wooden boards...', sortOrder: 1 },
      { name: 'Montessori Boards', description: 'Thoughtfully designed...', sortOrder: 2 },
      { name: 'Travel Boards', description: 'Compact, lightweight...', sortOrder: 3 },
      { name: 'Custom Boards', description: 'Personalized wooden...', sortOrder: 4 },
    ];

    const categoryMap = {};
    for (const cat of categoryData) {
      let c = await Category.findOne({ name: cat.name });
      if (!c) {
        c = await Category.create({ ...cat, isActive: true });
        console.log(`Category created: ${cat.name}`);
      }
      categoryMap[cat.name] = c._id;
    }

    // Create Products
    const productData = [
      {
        name: 'Ocean Explorer Busy Board',
        description: 'Dive into fun with our Ocean Explorer Busy Board! ...',
        price: 2499,
        mrp: 3499,
        category: 'Activity Boards',
        stock: 50,
        ageGroup: '1-3 years',
      },
      {
        name: 'Montessori Discovery Board',
        description: 'Inspired by Montessori principles, this Discovery Board ...',
        price: 3299,
        mrp: 4299,
        category: 'Montessori Boards',
        stock: 35,
        ageGroup: '2-5 years',
      },
    ];

    for (const p of productData) {
      let existing = await Product.findOne({ name: p.name });
      if (!existing) {
        await Product.create({
          ...p,
          category: categoryMap[p.category]
        });
        console.log(`Product created: ${p.name}`);
      }
    }

    console.log('Seed Complete');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
