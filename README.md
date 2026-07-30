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

## 缺失模型国内镜像

加载工作流时，工具包会将缺失模型元数据中的 Hugging Face 文件地址转换为 ModelScope 国内镜像地址。其他国外来源会改为按文件名搜索 ModelScope，不再直接指向原站。

缺失模型面板中的每个模型会显示 `高速下载` 按钮。可直接映射到 ModelScope 文件的模型会使用最多 8 路并发分片下载，并自动保存到对应的 ComfyUI 模型目录；无法直接映射的模型会打开 ModelScope 搜索。下载过程中再次点击主按钮可以暂停或继续，右侧的 `×` 可以取消任务并删除临时下载内容。连接超过 30 秒没有收到数据时会自动从当前分片位置重连。

侧栏中的 `缺失模型下载` 会汇总浏览器中所有已打开工作流的全部节点引用、工作流归属，以及本机尚未安装的模型。`一键高速下载全部` 会将可直接下载的模型加入统一队列：同一时间只让一个模型独占最多 8 路分片带宽，其余模型按顺序等待，避免多个大文件互相争抢带宽。旁边的 `一键暂停全部` 会暂停运行中和排队中的全部任务，并保留临时文件与当前进度。每个模型也可以单独开始、暂停、继续或取消。

ComfyUI 部署在服务器上时，下载任务由服务器上的 ToolBag 后端执行，模型会写入服务器的 ComfyUI 模型目录。运行 ComfyUI 的系统用户需要拥有该目录的写入权限。

受限模型需要先在 ModelScope 页面完成授权。高速下载器无法读取浏览器登录状态，因此会在需要时要求输入 ModelScope Access Token；令牌只用于当前下载任务，不会写入工作流或保存到磁盘。

## 服务器资源监控

侧栏中的 `服务器资源监控` 会实时显示 CPU、内存、显存、温度和硬盘空间。资源指标下方的 `一键临时卸载其他模型` 会请求 ComfyUI 释放已加载模型和缓存，同时让 Ollama 立即卸载当前驻留模型；它不会删除模型文件，下次使用时会重新加载。可通过 `TOOLBAG_OLLAMA_URL` 指定 Ollama API 地址。面板最下方还提供带二次确认的 `重启 ComfyUI` 按钮；该功能仅在 ComfyUI 由 systemd 管理并配置自动重启时启用，重启会中断当前执行和加载任务。

## 安装

将本目录 `ComfyUI-ToolBag` 放入 ComfyUI 的 `custom_nodes` 下即可，无需额外依赖。重启 ComfyUI 后即可在节点菜单中找到上述节点。

## Windows 一键启动

完成 ComfyUI 环境安装后，双击以下脚本即可启动 ComfyUI 和插件管理器：

```text
custom_nodes\ComfyUI-ToolBag\scripts\start_comfyui_windows.bat
```

脚本会自动定位 ComfyUI 根目录，并在端口已被占用时打开当前运行中的实例。可通过 `COMFYUI_ROOT`、`COMFYUI_HOST` 和 `COMFYUI_PORT` 环境变量覆盖默认设置。

## Linux 一键部署

ToolBag 自带 Linux 部署脚本，可自动检查 Python 和虚拟环境、识别 NVIDIA/AMD/Intel/CPU、安装 ComfyUI 依赖与插件管理器，并在安装失败时重试。

在 ComfyUI 根目录运行：

```bash
bash custom_nodes/ComfyUI-ToolBag/scripts/deploy_linux.sh --background
```

默认监听 `127.0.0.1:8188`。需要局域网访问时，可显式设置监听地址：

```bash
COMFYUI_HOST=0.0.0.0 bash custom_nodes/ComfyUI-ToolBag/scripts/deploy_linux.sh --background
```

使用 `--setup-only` 可只配置环境而不启动 ComfyUI。脚本也支持通过 `COMFYUI_ROOT`、`COMFYUI_VENV_DIR`、`COMFYUI_PYTHON` 和 `COMFYUI_TORCH_INDEX_URL` 覆盖自动检测结果。
