/**
 * Seed script: Injecter TOUS les produits Salon Supplies spécifiés
 * Run with: node scripts/seed-products.js
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
const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/png?text=Image+A+Ajouter"

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET_KEY || process.env.CLOUDINARY_API_SECRET
})

// Fonction d'upload d'image locale vers Cloudinary
async function uploadImage(source) {
  if (!source) return PLACEHOLDER_IMAGE
  
  const isUrl = typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))
  if (isUrl) return source
  
  const filePath = path.isAbsolute(source) ? source : path.resolve(BACKEND_DIR, source)
  
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Image introuvable localement : ${source} -> Remplacée par le placeholder.`)
    return PLACEHOLDER_IMAGE
  }

  try {
    const result = await cloudinary.uploader.upload(filePath, { resource_type: 'image' })
    return result.secure_url
  } catch (error) {
    console.error(`❌ Échec upload Cloudinary pour ${source}:`, error.message)
    return PLACEHOLDER_IMAGE
  }
}

// Constructeur du document final pour MongoDB
function buildProductDocument(seed) {
  const price = Number(seed.price)
  return {
    name: String(seed.name).trim(),
    description: String(seed.description).trim(),
    price: isNaN(price) ? 0 : price,
    categoryId: seed.categoryId,
    subCategoryId: seed.subCategoryId || undefined,
    inStock: seed.inStock !== false,
    image: seed.imageUrls, // Tableau d'URLs Cloudinary finales
    tag: seed.tag || "",   // Conserve ton tag personnalisé
    date: Date.now()
  }
}

async function seed() {
 const jsonPath = path.join(__dirname, 'total-catalog-seed.json')

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ Fichier introuvable : ${jsonPath}`)
    process.exit(1)
  }

  let products
  try {
    products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  } catch (err) {
    console.error('❌ Erreur de lecture du JSON:', err.message)
    process.exit(1)
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('🔌 Connecté à MongoDB Atlas')

    // Nettoyage de l'ancienne collection de produits
    await productModel.deleteMany({})
    console.log('🗑️ Collection "products" vidée avec succès.')

    // Récupérer ou créer la catégorie "Salon Supplies"
    let salonSuppliesCat = await categoryModel.findOne({ name: "Salon Supplies" })
    if (!salonSuppliesCat) {
      salonSuppliesCat = await categoryModel.create({ name: "Salon Supplies", image: PLACEHOLDER_IMAGE })
      console.log(`🆕 Catégorie créée en base : "Salon Supplies"`)
    }

    const toInsert = []
    let totalItems = products.length
    console.log(`⏳ Traitement et upload des images pour ${totalItems} produits...`)

    for (let i = 0; i < products.length; i++) {
      const p = products[i]

      // Extraction des images du champ "image" (ton JSON utilise "image")
      const rawImages = Array.isArray(p.image) ? p.image : (Array.isArray(p.images) ? p.images : [])
      const imageUrls = []

      for (const img of rawImages) {
        const uploadedUrl = await uploadImage(img)
        imageUrls.push(uploadedUrl)
      }

      // Si aucune image n'est spécifiée, on met le placeholder
      if (imageUrls.length === 0) {
        imageUrls.push(PLACEHOLDER_IMAGE)
      }

      // Préparation du document
      toInsert.push(buildProductDocument({
        ...p,
        categoryId: salonSuppliesCat._id,
        imageUrls
      }))

      console.log(`进度 [${i + 1}/${totalItems}] - Prêt : ${p.name}`)
    }

    // Insertion de TOUS les produits d'un coup
    if (toInsert.length > 0) {
      const result = await productModel.insertMany(toInsert)
      console.log(`\n🚀 SÉCURITÉ ET COPIE REUSSIE !`)
      console.log(`✅ Base de données mise à jour avec ${result.length} produits ajoutés dans "Salon Supplies".`)
    }

  } catch (err) {
    console.error('❌ Le seed a échoué :', err)
  } finally {
    await mongoose.disconnect()
    console.log('🔌 Déconnecté de MongoDB.')
    process.exit(0)
  }
}

seed()