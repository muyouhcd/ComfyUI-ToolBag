# ComfyUI-ToolBag

ComfyUI 自定义工具节点包。

## 节点说明

### 图像中心对齐合成 (ImageCompositeCenter)

- **路径**: `ToolBag/image` → 图像中心对齐合成 (ToolBag)
- **功能**: 将三张输入图像按顺序叠加，叠加方式为**中心对齐**。
- **输入**:
  - `image_1`: 底层图像（作为画布，决定输出尺寸）
  - `image_2`: 中层图像
  - `image_3`: 顶层图像
- **输出**: 一张合成后的图像（尺寸与 `image_1` 相同）
- **叠加顺序**: 从上到下依次为 图像1 → 图像2 → 图像3（图像1在最底，图像3在最上），所有图层中心对齐。

## 安装

将本目录 `ComfyUI-ToolBag` 放入 ComfyUI 的 `custom_nodes` 下即可，无需额外依赖。重启 ComfyUI 后即可在节点菜单中找到上述节点。
