# 南京大学羽毛球场预约脚本

Windows 计划任务每天 07:55 启动脚本，仅在本机 target.json 指定的使用日期运行。08:00 开放后扫描仙林校区四组团体育馆和方肇周体育馆的羽毛球场。双账号模式优先争取相邻的两小时，场号可以不同。仅在订单场馆、日期、时段和零元金额均吻合时支付；只有预约记录显示“已支付、正常”才算成功。

脚本使用 Microsoft Edge、Playwright 和本地 Python OCR。实际结果取决于场地库存、服务器状态及验证码识别，无法保证抢到场地。

## 新电脑安装

需要 Windows 11、Microsoft Edge 和 Node.js 22 或更新版本。Python 依赖由 [uv](https://docs.astral.sh/uv/getting-started/installation/) 管理；仓库中的 pyproject.toml、uv.lock 和 .python-version 固定依赖与 Python 3.11。uv 会在项目内创建 .venv，缺少 Python 3.11 时自动下载。无需激活虚拟环境，也无需安装 WSL。

从 [GitHub 仓库](https://github.com/EasonWangyc/nju-badminton-booker) 下载 ZIP 并解压，或在 **Windows PowerShell 5.1** 中克隆：

```powershell
git clone https://github.com/EasonWangyc/nju-badminton-booker.git
Set-Location -LiteralPath '.\nju-badminton-booker'
```

在项目目录运行后续命令。若尚未安装 uv，可先运行以下命令，然后重新打开 PowerShell：

```powershell
winget install --id=astral-sh.uv -e
```

若电脑没有 winget，按上面的 uv 官方安装说明安装。随后运行安装向导：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

安装向导会执行 npm ci 和 uv sync，检查 OCR 依赖，创建不入库的本地配置，提示输入要用的账号与同伴姓名，并用 Windows DPAPI 加密保存登录凭据。最后可选择安装 07:55 的计划任务。再次运行向导会保留已有本地配置和凭据；不会设置任何预约日期。

如果需要分步检查环境，可运行：

```powershell
Get-Command node.exe, npm.cmd, uv.exe -ErrorAction Stop
npm.cmd ci --omit=dev
uv.exe sync --locked
& '.\.venv\Scripts\python.exe' -c 'import ddddocr, cv2, onnxruntime'
```

config.example.json 默认使用 .venv\Scripts\python.exe。已有 WSL OCR 配置仍可继续使用；Windows 新安装推荐上述 .venv 方案。任务名为 NJU-Badminton-Booking，使用日期不等于当天时直接退出。电脑在预约时须开机联网，当前 Windows 用户须保持登录。

## 每天设置

双击 configure-booking.cmd，或在项目目录运行：

    node configure.js

菜单先选择明天或输入指定日期，再选择账号、场馆和时段；输入无效会提示重试，保存前会显示条件供确认。若只配置了一个账号，菜单默认选该账号；两个账号都有凭据时默认双账号。场馆默认两馆均可，优先 16:00–18:00，其次 18:00–20:00。双账号必须选择至少一组相邻时段，不会预约同一小时。使用日期是打球当天；设置后无需手动启动抢场脚本。node configure.js --interactive 与上述命令等效。

命令行示例：

    node configure.js 2026-12-01 --pair --venues 126,120 --accounts primary,secondary --times 16:00-17:00,17:00-18:00,18:00-19:00,19:00-20:00

场馆 ID 126 为四组团，120 为方肇周。可只选一个账号或场馆。清除目标日期：

    node configure.js --clear

## 检查和迁移

免下单预检：

    node pair.js YYYY-MM-DD --preflight

预检会登录并检查页面、同伴及场地表，不提交订单。自动运行日志在 logs\YYYY-MM-DD.log；最终以网站订单记录为准。本地纯逻辑测试：npm run test:pair、npm run test:payment、npm run test:retry。测试通过不代表真实预约成功。

config.local.json、target.json、DPAPI 凭据与会话、Edge 配置目录、日志、Python 虚拟环境和 node_modules 都被 .gitignore 排除。DPAPI 文件绑定原 Windows 用户与电脑；新电脑需重新保存账号凭据。不要向 GitHub 提交本地配置、浏览器目录、日志或订单截图。
