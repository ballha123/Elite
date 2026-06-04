import mongoose from "mongoose";

const productAttributesSchema = new mongoose.Schema({
    releaseDate: { type: String, default: "" },
    brand: { type: String, default: "" },
    range: { type: String, default: "" },
    productType: { type: String, default: "" },
    classification: { type: String, default: "" },
    content: { type: String, default: "" },
    country: { type: String, default: "" },
    // 👇 BADALNA ESM EL CHAMP HNA BECH MA YCONFLITIWCH MAA MONGOOSE
    productCollection: { type: String, default: "" }, 
    manufacturer: { type: String, default: "" },
    precautions: { type: String, default: "" },
    usageTips: { type: String, default: "" },
    ingredients: { type: String, default: "" },
}, { _id: false });

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    newPrice: { type: Number },
    image: { type: Array, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "category", required: true },
    subCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: "subcategory" },
    colors: { type: [String], required: true },
    productAttributes: { type: productAttributesSchema, default: () => ({}) },
    inStock: { type: Boolean, required: true, default: true },
    bestseller: { type: Boolean },
    date: { type: Number, required: true }
});

productSchema.index({ categoryId: 1 });
productSchema.index({ bestseller: 1 });
productSchema.index({ date: -1 });
productSchema.index({ categoryId: 1, subCategoryId: 1 });

const productModel = mongoose.models.product || mongoose.model("product", productSchema);

export default productModel;