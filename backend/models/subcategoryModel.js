import mongoose from "mongoose";

const subcategorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "category", required: true }
}, { timestamps: true });

subcategorySchema.index({ categoryId: 1, name: 1 }, { unique: true });

const subCategoryModel = mongoose.models.subcategory || mongoose.model("subcategory", subcategorySchema, "subcategories");
export default subCategoryModel;
