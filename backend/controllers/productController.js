import { v2 as cloudinary } from "cloudinary"
import productModel from "../models/productModel.js"
import reviewModel from "../models/reviewModel.js"
import subcategoryModel from "../models/subcategoryModel.js"
import categoryModel from "../models/categoryModel.js"
import favoriteModel from "../models/favoriteModel.js"
import { sendPriceDropEmail } from "../services/mailService.js"

const defaultProductAttributes = {
    releaseDate: "",
    brand: "",
    range: "",
    productType: "",
    classification: "",
    content: "",
    country: "",
    collection: "",
    manufacturer: "",
    precautions: "",
    usageTips: "",
    ingredients: "",
}

const normalizeProductAttributes = (input) => {
    let parsed = input
    if (typeof input === "string") {
        try {
            parsed = JSON.parse(input)
        } catch {
            parsed = {}
        }
    }
    const source = parsed && typeof parsed === "object" ? parsed : {}
    const normalized = { ...defaultProductAttributes }
    for (const key of Object.keys(defaultProductAttributes)) {
        normalized[key] = source[key] != null ? String(source[key]).trim() : ""
    }
    return normalized
}

// Helper pour vérifier si une chaîne est une URL valide (évite d'envoyer des liens à l'uploader de Cloudinary)
const isUrl = (str) => {
    if (typeof str !== 'string') return false;
    return str.startsWith('http://') || str.startsWith('https://');
}

// function for add product
const addProduct = async (req, res) => {
    try {

        const { name, description, price, newPrice, categoryId, subCategoryId, colors, bestseller, inStock, discountTimer, productAttributes, images: incomingImages } = req.body

        // Validation
        if (!name || !description || !categoryId) {
            return res.json({ success: false, message: "Name, description and category are required" })
        }
        const category = await categoryModel.findById(categoryId)
        if (!category) {
            return res.json({ success: false, message: "Category not found" })
        }
        if (subCategoryId) {
            const sub = await subcategoryModel.findOne({ _id: subCategoryId, categoryId })
            if (!sub) {
                return res.json({ success: false, message: "Subcategory does not belong to the selected category" })
            }
        }
        const priceNum = Number(price)
        if (isNaN(priceNum) || priceNum < 0) {
            return res.json({ success: false, message: "Valid price is required" })
        }

        let colorsArray = []
        try {
            colorsArray = typeof colors === 'string' ? JSON.parse(colors) : colors
        } catch {
            return res.json({ success: false, message: "Colors must be a valid JSON array of strings (e.g. [\"Red\",\"Blue\"])" })
        }
        if (!Array.isArray(colorsArray) || colorsArray.length === 0 || !colorsArray.every(c => typeof c === 'string')) {
            return res.json({ success: false, message: "Colors must be a non-empty array of strings" })
        }

        // Récupération des fichiers uploadés par formulaire (Multer)
        const image1 = req.files?.image1?.[0]
        const image2 = req.files?.image2?.[0]
        const image3 = req.files?.image3?.[0]
        const image4 = req.files?.image4?.[0]
        const fileImages = [image1, image2, image3, image4].filter((item) => item !== undefined)

        let imagesUrl = []

        // 1. Si des URLs brutes ont été envoyées (cas du script de seed ou API textuelle)
        if (incomingImages) {
            let parsedIncoming = []
            try {
                parsedIncoming = typeof incomingImages === 'string' ? JSON.parse(incomingImages) : incomingImages
            } catch {
                parsedIncoming = [incomingImages]
            }
            if (Array.isArray(parsedIncoming)) {
                imagesUrl = parsedIncoming.filter(img => isUrl(img))
            }
        }

        // 2. Si des fichiers physiques sont présents, on les envoie sur Cloudinary
        if (fileImages.length > 0) {
            const uploadedUrls = await Promise.all(
                fileImages.map(async (item) => {
                    const result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' })
                    return result.secure_url
                })
            )
            imagesUrl = [...imagesUrl, ...uploadedUrls]
        }

        const newPriceNum = newPrice !== undefined && newPrice !== '' ? Number(newPrice) : undefined
        const hasValidNewPrice = !isNaN(newPriceNum) && newPriceNum >= 0

        let discountEndsAt = null
        if (hasValidNewPrice && discountTimer) {
            const hours = parseInt(discountTimer, 10)
            if (!isNaN(hours) && hours > 0) {
                discountEndsAt = Date.now() + hours * 60 * 60 * 1000
            }
        }

        const productData = {
            name: name.trim(),
            description: description.trim(),
            categoryId,
            subCategoryId: subCategoryId || undefined,
            price: priceNum,
            newPrice: hasValidNewPrice ? newPriceNum : undefined,
            discountEndsAt,
            colors: colorsArray.map(c => String(c).trim()),
            productAttributes: normalizeProductAttributes(productAttributes),
            inStock: inStock === "false" ? false : true,
            bestseller: bestseller === "true",
            image: imagesUrl, 
            date: Date.now()
        }

        const product = new productModel(productData)
        await product.save()

        res.json({ success: true, message: "Product Added" })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// function for list product
const listProducts = async (req, res) => {
    try {

        const products = await productModel.find({})
            .populate("categoryId", "name")
            .populate("subCategoryId", "name")
            .populate("image")
            .lean()

        const productIds = products.map(p => p._id)
        const ratingAgg = await reviewModel.aggregate([
            { $match: { productId: { $in: productIds } } },
            { $group: { _id: "$productId", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } }
        ])
        const ratingMap = Object.fromEntries(ratingAgg.map(r => [String(r._id), { avg: Math.round(r.avgRating * 10) / 10, count: r.count }]))

        const productsWithDisplayPrice = products.map(p => {
            const obj = { ...p }
            const ratingData = ratingMap[String(p._id)]
            obj.displayPrice = p.newPrice ?? p.price
            obj.category = p.categoryId?.name ?? null
            obj.subCategory = p.subCategoryId?.name ?? null
            obj.avgRating = ratingData?.avg ?? null
            obj.reviewCount = ratingData?.count ?? 0
            return obj
        })
        res.json({ success: true, products: productsWithDisplayPrice })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// function for removing product
const removeProduct = async (req, res) => {
    try {

        await productModel.findByIdAndDelete(req.body.id)
        res.json({ success: true, message: "Product Removed" })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// function for single product info
const singleProduct = async (req, res) => {
    try {

        const { productId } = req.body
        const product = await productModel.findById(productId)
            .populate("categoryId", "name")
            .populate("subCategoryId", "name")
        if (!product) {
            return res.json({ success: false, message: "Product not found" })
        }

        const reviews = await reviewModel
            .find({ productId })
            .populate("userId", "firstName lastName")
            .sort({ createdAt: -1 })
            .lean()

        const productObj = product.toObject()
        productObj.displayPrice = product.newPrice ?? product.price
        productObj.category = product.categoryId?.name ?? null
        productObj.subCategory = product.subCategoryId?.name ?? null
        productObj.categoryId = product.categoryId?._id
        productObj.subCategoryId = product.subCategoryId?._id
        productObj.reviews = reviews
        res.json({ success: true, product: productObj })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// function for update product
const updateProduct = async (req, res) => {
    try {
        const { id, name, description, price, newPrice, categoryId, subCategoryId, colors, bestseller, inStock, discountTimer, productAttributes, images: incomingImages } = req.body

        if (!id) {
            return res.json({ success: false, message: "Product ID is required" })
        }
        const product = await productModel.findById(id)
        if (!product) {
            return res.json({ success: false, message: "Product not found" })
        }

        if (!name || !description || !categoryId) {
            return res.json({ success: false, message: "Name, description and category are required" })
        }
        const category = await categoryModel.findById(categoryId)
        if (!category) {
            return res.json({ success: false, message: "Category not found" })
        }
        if (subCategoryId) {
            const sub = await subcategoryModel.findOne({ _id: subCategoryId, categoryId })
            if (!sub) {
                return res.json({ success: false, message: "Subcategory does not belong to the selected category" })
            }
        }
        const priceNum = Number(price)
        if (isNaN(priceNum) || priceNum < 0) {
            return res.json({ success: false, message: "Valid price is required" })
        }

        let colorsArray = []
        try {
            colorsArray = typeof colors === 'string' ? JSON.parse(colors) : (colors || [])
        } catch {
            return res.json({ success: false, message: "Colors must be a valid JSON array" })
        }
        if (!Array.isArray(colorsArray) || colorsArray.length === 0 || !colorsArray.every(c => typeof c === 'string')) {
            return res.json({ success: false, message: "Colors must be a non-empty array of strings" })
        }

        const newPriceNum = newPrice !== undefined && newPrice !== '' ? Number(newPrice) : undefined
        const hasValidNewPrice = newPriceNum !== undefined && !isNaN(newPriceNum) && newPriceNum >= 0

        // Gestion de la mise à jour des images
        let imagesUrl = [...(product.image || [])]
        
        // Si le body contient de nouvelles URLs directes, on écrase ou on fusionne selon tes besoins (ici on remplace)
        if (incomingImages) {
            let parsedIncoming = []
            try {
                parsedIncoming = typeof incomingImages === 'string' ? JSON.parse(incomingImages) : incomingImages
            } catch {
                parsedIncoming = [incomingImages]
            }
            if (Array.isArray(parsedIncoming)) {
                imagesUrl = parsedIncoming.filter(img => isUrl(img))
            }
        }

        const image1 = req.files?.image1?.[0]
        const image2 = req.files?.image2?.[0]
        const image3 = req.files?.image3?.[0]
        const image4 = req.files?.image4?.[0]

        // On remplace les indexes spécifiés si un fichier physique Multer est soumis
        if (image1) {
            const result = await cloudinary.uploader.upload(image1.path, { resource_type: 'image' })
            imagesUrl[0] = result.secure_url
        }
        if (image2) {
            const result = await cloudinary.uploader.upload(image2.path, { resource_type: 'image' })
            imagesUrl[1] = result.secure_url
        }
        if (image3) {
            const result = await cloudinary.uploader.upload(image3.path, { resource_type: 'image' })
            imagesUrl[2] = result.secure_url
        }
        if (image4) {
            const result = await cloudinary.uploader.upload(image4.path, { resource_type: 'image' })
            imagesUrl[3] = result.secure_url
        }

        const prevPrice = product.price
        const prevNewPrice = product.newPrice
        const displayOldPrice = prevNewPrice != null && prevNewPrice !== '' ? prevNewPrice : prevPrice

        product.name = name.trim()
        product.description = description.trim()
        product.categoryId = categoryId
        product.subCategoryId = subCategoryId || undefined
        product.price = priceNum
        product.newPrice = hasValidNewPrice ? newPriceNum : undefined
        if (discountTimer !== undefined && discountTimer !== null) {
            if (hasValidNewPrice && discountTimer) {
                const hours = parseInt(discountTimer, 10)
                product.discountEndsAt = (!isNaN(hours) && hours > 0) ? Date.now() + hours * 60 * 60 * 1000 : null
            } else {
                product.discountEndsAt = null
            }
        }
        product.colors = colorsArray.map(c => String(c).trim())
        product.productAttributes = normalizeProductAttributes(productAttributes || product.productAttributes)
        product.inStock = inStock === "false" ? false : true
        product.bestseller = bestseller === "true"
        product.image = imagesUrl.filter(Boolean) 

        await product.save()

        // Price drop: newPrice decreased – notify users who favorited this product
        if (hasValidNewPrice && newPriceNum < displayOldPrice) {
            favoriteModel
                .find({ productId: id })
                .populate("userId", "email firstName")
                .lean()
                .then((favorites) => {
                    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173"
                    const productUrl = `${baseUrl}/product/${id}`
                    const productImage = product.image?.[0]
                    const productName = product.name

                    favorites.forEach((f) => {
                        const user = f.userId
                        if (user?.email) {
                            sendPriceDropEmail({
                                to: user.email,
                                customerName: user.firstName || "Customer",
                                productName,
                                productImage,
                                oldPrice: displayOldPrice,
                                newPrice: newPriceNum,
                                productUrl,
                            }).catch((e) => console.error("Price drop email failed:", e))
                        }
                    })
                })
                .catch((e) => console.error("Price drop notification lookup failed:", e))
        }

        res.json({ success: true, message: "Product updated" })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: message.error })
    }
}

export { listProducts, addProduct, removeProduct, singleProduct, updateProduct }