// server.js
require('dotenv').config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ⭐ 簽名檔存放資料夾
const signDir = path.join(__dirname, "sign_data");
if (!fs.existsSync(signDir)) fs.mkdirSync(signDir);

// ⭐ 確認環境變數
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("⚠️ 請設定 EMAIL_USER / EMAIL_PASS");
}

// ⭐ 記錄服務啟動時間 (Uptime 計算用)
const serverStartTime = new Date();

// ⭐ 首頁
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ⭐ 健康檢查路由 (Uptime + JSON)
app.get("/health", (req, res) => {
    const now = new Date();
    const uptimeMs = now - serverStartTime;
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;

    res.json({
        status: "OK",
        uptime: `${hours}h ${minutes}m ${seconds}s`,
        timestamp: now.toISOString()
    });
});

// ⭐ 簽約 API
app.post("/sign", async (req, res) => {
    try {
        const { name, id, phone, address, signature, percent, consultFee, remaining, time } = req.body;
	const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";  // ⭐ 自動抓 IP

        if (!signature || !signature.includes("base64")) {
            return res.status(400).json({ error: "簽名資料不正確" });
        }

        const fontPath = path.join(__dirname, "fonts", "NotoSansTC-Regular.ttf");
        if (!fs.existsSync(fontPath)) return res.status(500).json({ error: "字體檔缺失" });

        const fontBytes = fs.readFileSync(fontPath);
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const font = await pdfDoc.embedFont(fontBytes);

        const page = pdfDoc.addPage([595, 842]);
        const width = page.getWidth();
        let y = 780;

        // 標題
        const title = "貸 款 委 任 契 約 書";
        const titleSize = 28;
        page.drawText(title, { x: (width - font.widthOfTextAtSize(title, titleSize)) / 2, y, size: titleSize, font, color: rgb(0, 0, 0.6) });
        y -= 50;

        // 使用者資料
        const fields = [
            `姓名: ${name}`,
            `身分證: ${id}`,
            `電話: ${phone}`,
            `地址: ${address}`,
            `簽署時間: ${time}`,
            `IP: ${ip}`
        ];
        fields.forEach(f => {
            const w = font.widthOfTextAtSize(f, 12);
            page.drawText(f, { x: (width - w) / 2, y, size: 12, font });
            y -= 18;
        });
        y -= 10;

        // 合約矩形
        const contractX = 50, contractW = 495, contractH = 300;
        const contractY = y - contractH;
        page.drawRectangle({ x: contractX, y: contractY, width: contractW, height: contractH, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });

        // 自動換行函式
        function drawWrappedText(page, text, x, y, maxWidth, font, fontSize, lineHeight) {
            const chars = text.split("");
            let line = "", textY = y;
            chars.forEach(char => {
                const testLine = line + char;
                if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth) {
                    page.drawText(line, { x, y: textY, size: fontSize, font });
                    line = char;
                    textY -= lineHeight;
                } else line = testLine;
            });
            if (line) page.drawText(line, { x, y: textY, size: fontSize, font });
            return textY - lineHeight;
        }

        // ⭐ 動態合約內容
        const contractText = `
甲方：將御線上理財平臺
乙方：${name}

一、委任期間：自簽約日起三十日止，經雙方書面同意得延展。
二、報酬：約定於撥款後，扣除銀行或融資機構內扣費用後，依核准金額之${percent}%支付乙方顧問服務費，另付諮詢作業費新台幣${consultFee}元整，尚未收齊差額為${remaining}元。
三、違約：違約金50,000元，仍須支付服務費。
四、文件與保密：資料需真實，並負保密責任。
五、聯徵查詢：同意查詢信用資料。
六、契約變更終止：須書面同意。
七、簽署方式：通訊簽署等同親簽。
`;

        let textY = contractY + contractH - 20;
        contractText.split("\n").forEach(line => {
            if (line.trim()) textY = drawWrappedText(page, line.trim(), contractX + 10, textY, contractW - 20, font, 12, 18) - 8;
        });

        // 簽名
        const sigBytes = Buffer.from(signature.split(",")[1], "base64");
        const sigImage = await pdfDoc.embedPng(sigBytes);
        page.drawImage(sigImage, { x: 100, y: contractY - 120, width: 400, height: 100 });

        // 儲存 PDF
        const pdfBytes = await pdfDoc.save();
        const fileName = `${Date.now()}_${name}.pdf`;
        const filePath = path.join(signDir, fileName);
        fs.writeFileSync(filePath, pdfBytes);

        res.json({ ok: true, file: fileName });

        // ⭐ 自動寄信到自己
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            (async () => {
                try {
                    const transporter = nodemailer.createTransport({
                        service: "gmail",
                        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
                    });

                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: process.env.EMAIL_USER,
                        subject: "您的合約PDF",
                        text: "合約PDF已附上，請查收",
                        attachments: [{ filename: fileName, path: filePath }]
                    });

                    console.log("📩 已寄出 PDF");
                } catch (err) {
                    console.error("寄信錯誤", err);
                }
            })();
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "簽約失敗" });
    }
});

// ⭐ 使用 Render 指定的 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));
