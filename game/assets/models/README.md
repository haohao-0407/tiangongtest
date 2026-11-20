# Voxel asset library

This folder contains 68 FBX source models, organized under `FBX/` by category, item type, and dominant material. The categories are Structure (34), Furniture (9), Production (12), Agriculture (9), and Other (4). Paths and filenames use English names.

`AssetCatalog.csv` is the source inventory. Its `FBXPath` values are relative to this folder; `Footprint` is the logical placement size, while `VisualBoundsMeters` records the model's actual bounding dimensions. `GameAssetCatalog.xlsx` is a sortable copy of the inventory, and `MissingListItems.csv` identifies list entries that have not yet been modeled.

`Previews/AllAssets/` contains one render for each FBX, plus `AllAssets_Overview.png`, `Animal_Size_Comparison.png`, and seven category sheets in `Sheets/`. The preview images were rendered from the current FBX files. The farm animals share a 0.09 m voxel module, with cow larger than sheep and sheep larger than chicken.

These FBX files are authoring assets. Any model used in the running ForgeaX game still needs to be registered through the game's asset import process and given a stable GUID; this folder alone does not add objects to the scene.
