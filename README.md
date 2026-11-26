# 南京大学羽毛球场预约脚本

Windows 计划任务每天 07:55 启动脚本，仅在本机 target.json 指定的使用日期运行。08:00 开放后扫描仙林校区四组团体育馆和方肇周体育馆的羽毛球场。双账号模式优先争取相邻的两小时，场号可以不同。仅在订单场馆、日期、时段和零元金额均吻合时支付；只有预约记录显示“已支付、正常”才算成功。

脚本使用 Microsoft Edge、Playwright 和本地 Python OCR。实际结果取决于场地库存、服务器状态及验证码识别，无法保证抢到场地。

## 新电脑安装

需要 Windows 11、Microsoft Edge、Node.js 22 或更新版本，以及 Python 3。以下命令在项目目录的 Windows PowerShell 5.1 中运行。

1. 安装 Node 依赖：

    npm ci --omit=dev

2. 建立 OCR 环境：

    py -m venv .venv
    & '.\.venv\Scripts\python.exe' -m pip install -r '.\requirements-ocr.txt'

   如果 py 不可用，可用已安装的 Python 3 可执行文件替代。也支持 WSL：在 config.local.json 中将 ocr.runner 设为 wsl，填写发行版和 Linux Python 的绝对路径，并在该环境安装 requirements-ocr.txt。Windows 方案无需 WSL。

3. 复制示例并填写本机设置：

    Copy-Item -LiteralPath '.\config.example.json' -Destination '.\config.local.json'
    Copy-Item -LiteralPath '.\target.example.json' -Destination '.\target.json'

   为所用账号填写同伴姓名。使用上述 Windows Python 环境时，将 config.local.json 的 ocr 部分设置为：

    "ocr": { "runner": "windows", "python": ".venv\\Scripts\\python.exe" }

4. 交互保存各账号凭据。密码由当前 Windows 用户的 DPAPI 加密，不要写入命令行：

    .\save-credential.ps1 -Account primary
    .\save-credential.ps1 -Account secondary

   若系统的脚本执行策略阻止运行，可用 PowerShell 的 -ExecutionPolicy Bypass -File 参数单次执行。

5. 安装每天运行的计划任务：

    .\install-task.ps1

   任务名 NJU-Badminton-Booking，07:55 启动。使用日期不等于当天时直接退出。电脑在预约时须开机联网，当前 Windows 用户须保持登录。

## 每天设置

双击 每天设置预约.cmd，或运行：

    node configure.js --interactive

菜单可选使用日期、账号、场馆和时段。默认双账号、两馆均可，优先 16:00–18:00，其次 18:00–20:00。双账号必须选择至少一组相邻时段，不会预约同一小时。使用日期是打球当天；设置后无需手动启动抢场脚本。

命令行示例：

    node configure.js 2026-12-01 --pair --venues 126,120 --accounts primary,secondary --times 16:00-17:00,17:00-18:00,18:00-19:00,19:00-20:00

场馆 ID 126 为四组团，120 为方肇周。可只选一个账号或场馆。清除目标日期：

    node configure.js --clear

## 检查和迁移

免下单预检：

    node pair.js YYYY-MM-DD --preflight

预检会登录并检查页面、同伴及场地表，不提交订单。自动运行日志在 logs\YYYY-MM-DD.log；最终以网站订单记录为准。本地纯逻辑测试：npm run test:pair、npm run test:payment、npm run test:retry。测试通过不代表真实预约成功。

config.local.json、target.json、DPAPI 凭据与会话、Edge 配置目录、日志、Python 虚拟环境和 node_modules 都被 .gitignore 排除。DPAPI 文件绑定原 Windows 用户与电脑；新电脑需重新保存账号凭据。不要向 GitHub 提交本地配置、浏览器目录、日志或订单截图。
