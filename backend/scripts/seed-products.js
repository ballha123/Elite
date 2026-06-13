/**
 * Seed script: Injecter TOUS les produits avec gestion dynamique des catégories
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
// (Note : categoryId est maintenant passé dynamiquement)
function buildProductDocument(seed) {
  const price = Number(seed.price)
  return {
    name: String(seed.name).trim(),
    description: String(seed.description).trim(),
    price: isNaN(price) ? 0 : price,
    categoryId: seed.categoryId,
    subCategoryId: seed.subCategoryId || undefined,
    inStock: seed.inStock !== false,
    image: seed.imageUrls,
    tag: seed.tag || "",
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

    // Cache local pour stocker les IDs des catégories et éviter les requêtes DB redondantes
    const categoryCache = {}

    const toInsert = []
    let totalItems = products.length
    console.log(`⏳ Traitement, gestion des catégories et upload des images pour ${totalItems} produits...`)

    for (let i = 0; i < products.length; i++) {
      const p = products[i]

      // 1. Détermination du nom de la catégorie cible
      // Si "category" existe dans le JSON (ex: "Électronique"), on le prend. Sinon, fallback sur "Salon Supplies".
      let targetCategoryName = p.category ? String(p.category).trim() : "Salon Supplies"

      // [Optionnel] Si ton JSON n'a pas encore de champ "category", tu peux automatiser par mot-clé ici :
      // if (!p.category && (p.name.toLowerCase().includes('phone') || p.name.toLowerCase().includes('machine'))) {
      //   targetCategoryName = "Électronique"
      // }

      // 2. Récupération ou création de la catégorie (via Cache -> MongoDB)
      if (!categoryCache[targetCategoryName]) {
        let cat = await categoryModel.findOne({ name: targetCategoryName })
        if (!cat) {
          cat = await categoryModel.create({ name: targetCategoryName, image: PLACEHOLDER_IMAGE })
          console.log(`🆕 Nouvelle catégorie créée en base : "${targetCategoryName}"`)
        }
        // On stocke l'ID trouvé ou créé dans notre cache
        categoryCache[targetCategoryName] = cat._id
      }

      const currentCategoryId = categoryCache[targetCategoryName]

      // 3. Extraction et upload des images
      const rawImages = Array.isArray(p.image) ? p.image : (Array.isArray(p.images) ? p.images : [])
      const imageUrls = []

      for (const img of rawImages) {
        const uploadedUrl = await uploadImage(img)
        imageUrls.push(uploadedUrl)
      }

      if (imageUrls.length === 0) {
        imageUrls.push(PLACEHOLDER_IMAGE)
      }

      // 4. Préparation du document avec la bonne categoryId
      toInsert.push(buildProductDocument({
        ...p,
        categoryId: currentCategoryId,
        imageUrls
      }))

      console.log(`进度 [${i + 1}/${totalItems}] - Prêt [${targetCategoryName}] : ${p.name}`)
    }

    // Insertion globale
    if (toInsert.length > 0) {
      const result = await productModel.insertMany(toInsert)
      console.log(`\n🚀 SÉCURITÉ ET COPIE REUSSIE !`)
      console.log(`✅ Base de données mise à jour avec ${result.length} produits répartis dans leurs catégories respectives.`)
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