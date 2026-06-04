/**
 * Seed script: Create products in bulk from a JSON file
 *
 * Run with: node scripts/seed-products.js [path-to-json]
 * Default: scripts/products-seed.json
 *
 * Prerequisites:
 * - Run seed:categories first (or have categories in DB)
 * - Images: use local paths (relative to backend folder) or public image URLs
 */

import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import productModel from '../models/productModel.js'
import categoryModel from '../models/categoryModel.js'
import subcategoryModel from '../models/subcategoryModel.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(__dirname, '..')
const MIN_PRODUCTS_PER_CATEGORY = 10

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET_KEY || process.env.CLOUDINARY_API_SECRET
})

async function uploadImage(source) {
  const isUrl = typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))
  
  // FIX CRUCIAL : Si c'est déjà une URL web (Unsplash, etc.), on ne l'envoie plus à Cloudinary !
  if (isUrl) {
    return source
  }
  
  // Si c'est un fichier local sur ton PC, on l'upload normalement
  const filePath = path.isAbsolute(source) ? source : path.resolve(BACKEND_DIR, source)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Image not found: ${filePath}`)
  }
  const result = await cloudinary.uploader.upload(filePath, { resource_type: 'image' })
  return result.secure_url
}

function buildProductDocument(seed, suffixNumber = null) {
  const price = Number(seed.price)
  const newPrice = seed.newPrice != null && seed.newPrice !== '' ? Number(seed.newPrice) : undefined
  const hasValidNewPrice = !isNaN(newPrice) && newPrice >= 0

  let discountEndsAt = null
  if (hasValidNewPrice && seed.discountTimer) {
    const hours = parseInt(seed.discountTimer, 10)
    if (!isNaN(hours) && hours > 0) {
      discountEndsAt = Date.now() + hours * 60 * 60 * 1000
    }
  }

  const baseName = String(seed.name).trim()
  const finalName = suffixNumber ? `${baseName} ${suffixNumber}` : baseName

  return {
    name: finalName,
    description: String(seed.description).trim(),
    price: isNaN(price) ? 0 : price,
    newPrice: hasValidNewPrice ? newPrice : undefined,
    discountEndsAt,
    categoryId: seed.categoryId,
    subCategoryId: seed.subCategoryId || undefined,
    colors: seed.colors,
    inStock: seed.inStock !== false,
    bestseller: seed.bestseller === true,
    image: seed.imageUrls, // Tableau d'URLs (directes ou Cloudinary)
    date: Date.now()
  }
}

async function seed() {
  const jsonPath = process.argv[2] || path.join(__dirname, 'products-seed.json')
  const absPath = path.isAbsolute(jsonPath) ? jsonPath : path.resolve(process.cwd(), jsonPath)

  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`)
    console.log('Create products-seed.json (see products-seed.example.json) or pass a path:')
    console.log('  node scripts/seed-products.js ./my-products.json')
    process.exit(1)
  }

  let products
  try {
    const raw = fs.readFileSync(absPath, 'utf8')
    products = JSON.parse(raw)
  } catch (err) {
    console.error('Invalid JSON:', err.message)
    process.exit(1)
  }

  if (!Array.isArray(products) || products.length === 0) {
    console.error('JSON must be an array of products.')
    process.exit(1)
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('Connected to MongoDB')

    // FIX DUBLONS : Nettoyer la collection à blanc avant l'insertion
    await productModel.deleteMany({})
    console.log('🗑️ Collection "products" nettoyée avec succès.')

    const categoriesByName = {}
    const subcategoriesByKey = {}
    const preparedByCategory = {}
    let skipped = 0

    for (const p of products) {
      if (!p.name || !p.description || p.price == null) {
        console.warn(`Skipping product: missing name, description, or price`)
        skipped++
        continue
      }

      // Extraction des images (gère "image" et "images")
      const images = Array.isArray(p.image) ? p.image : (Array.isArray(p.images) ? p.images : [])
      
      let categoryId = p.categoryId
      if (!categoryId && p.category) {
        const catName = String(p.category).trim()
        if (!categoriesByName[catName]) {
          let cat = await categoryModel.findOne({ name: catName })
          if (!cat) {
            cat = await categoryModel.create({ name: catName, image: images[0] || '' })
            console.log(`🆕 Catégorie créée automatiquement : "${catName}"`)
          }
          categoriesByName[catName] = cat._id
        }
        categoryId = categoriesByName[catName]
      }
      if (!categoryId) {
        console.warn(`Skipping "${p.name}": no category or categoryId`)
        skipped++
        continue
      }

      let subCategoryId = p.subCategoryId || null
      if (!subCategoryId && p.subCategory && categoryId) {
        const subName = String(p.subCategory).trim()
        const key = `${categoryId}-${subName}`
        
        if (!subcategoriesByKey[key]) {
          let sub = await subcategoryModel.findOne({ categoryId, name: subName })
          if (!sub) {
            sub = await subcategoryModel.create({ categoryId, name: subName })
            console.log(`🆕 Sous-catégorie créée automatiquement : "${subName}"`)
          }
          subcategoriesByKey[key] = sub._id
        }
        subCategoryId = subcategoriesByKey[key] || null
      }

      const colors = Array.isArray(p.colors) ? p.colors.map(String) : ['Blanc']
      
      if (images.length === 0) {
        console.warn(`Skipping "${p.name}": at least one image required`)
        skipped++
        continue
      }

      let imageUrls = []
      try {
        for (const img of images.slice(0, 4)) {
          imageUrls.push(await uploadImage(img))
        }
      } catch (err) {
        console.warn(`Skipping "${p.name}": image upload failed -`, err.message)
        skipped++
        continue
      }

      const catKey = String(categoryId)
      if (!preparedByCategory[catKey]) preparedByCategory[catKey] = []
      preparedByCategory[catKey].push({
        ...p,
        categoryId,
        subCategoryId: subCategoryId || null,
        colors,
        imageUrls
      })
    }

    const allCategories = await categoryModel.find({}).sort({ name: 1 }).lean()
    if (allCategories.length === 0) {
      console.log('No categories found in DB. Automatically creating categories based on JSON data...')
    }

    const globalTemplate = (() => {
      const firstWithData = Object.values(preparedByCategory).flat()[0]
      return firstWithData || null
    })()

    if (!globalTemplate) {
      console.log('No valid products to insert.')
      console.log(`Skipped: ${skipped}`)
      return
    }

    // Si la DB est vide au niveau des catégories, on récupère celles créées à la volée
    const activeCategories = allCategories.length > 0 ? allCategories : await categoryModel.find({}).lean()

    const categoryNameById = {}
    for (const c of activeCategories) categoryNameById[String(c._id)] = c.name

    const subsByCategory = {}
    const allSubs = await subcategoryModel.find({}).lean()
    for (const s of allSubs) {
      const cid = String(s.categoryId)
      if (!subsByCategory[cid]) subsByCategory[cid] = []
      subsByCategory[cid].push(s)
    }

    let createdCount = 0
    for (const cat of activeCategories) {
      const catId = String(cat._id)
      const catName = categoryNameById[catId] || cat.name
      const templates = preparedByCategory[catId] || []

      const toInsert = []

      if (templates.length > 0) {
        for (const t of templates) {
          toInsert.push(buildProductDocument(t))
        }
        
        // Système de remplissage automatique si la catégorie contient moins que MIN_PRODUCTS_PER_CATEGORY (10)
        const missing = MIN_PRODUCTS_PER_CATEGORY - toInsert.length
        if (missing > 0 && templates.length > 0) {
          for (let i = 0; i < missing; i++) {
            const base = templates[i % templates.length]
            toInsert.push(buildProductDocument(base, templates.length + i + 1))
          }
        }
      }

      if (toInsert.length > 0) {
        await productModel.insertMany(toInsert)
        createdCount += toInsert.length
        console.log(`Category "${catName}": created ${toInsert.length} product(s)`)
      }
    }

    console.log(`Seed complete. Created: ${createdCount}, Skipped: ${skipped}`)
  } catch (err) {
    console.error('Seed failed:', err)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    process.exit(0)
  }
}

seed()