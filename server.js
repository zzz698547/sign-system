require('dotenv').config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const nodemailer = require("nodemailer");

const app = express();

// ⭐ JSON 限制
app.use(express.json({ limit: "10mb" }));

// ⭐ 靜態網站（HTML / CSS / JS）
app.use(express.static(path.join(__dirname, "public")));

// ⭐ 確保資料夾存在
const signDir = path.join(__dirname, "sign_data");
if (!fs.existsSync(signDir)) {
  fs.mkdirSync(signDir);
}

// ⭐ 檢查 env
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn("⚠️ 請設定 EMAIL_USER / EMAIL_PASS");
}

/* =========================
   ⭐ 首頁
========================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================
   ⭐ 簽約 API
========================= */
app.post("/sign", async (req, res) => {
  try {
    const { name, id, phone, address, signature, time, ip, email } = req.body;

    // ⭐ 字體
    const fontPath = path.join(__dirname, "fonts", "NotoSansTC-Regular.ttf");
    if (!fs.existsSync(fontPath)) {
      return res.status(500).json({ error: "字體檔缺失" });
    }

    const fontBytes = fs.readFileSync(fontPath);
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes);

    const page = pdfDoc.addPage([595, 842]);
    const width = page.getWidth();
    let y = 780;

    // ⭐ 標題
    const title = "貸 款 委 任 契 約 書";
    const titleSize = 28;
    const titleWidth = font.widthOfTextAtSize(title, titleSize);

    page.drawText(title, {
      x: (width - titleWidth) / 2,
      y,
      size: titleSize,
      font,
      color: rgb(0, 0, 0.6)
    });

    y -= 50;

    // ⭐ 使用者資料
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
      page.drawText(f, {
        x: (width - w) / 2,
        y,
        size: 12,
        font
      });
      y -= 18;
    });

    y -= 10;

    // ⭐ 合約內容矩形
    const contractX = 50;
    const contractW = 495;
    const contractH = 300;
    const contractY = y - contractH;

    page.drawRectangle({
      x: contractX,
      y: contractY,
      width: contractW,
      height: contractH,
      color: rgb(0.97, 0.97, 0.97),
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
    });

    // ⭐ 自動換行函式
    function drawWrappedText(page, text, x, y, maxWidth, font, fontSize, lineHeight) {
      const chars = text.split(""); // 中文逐字
      let line = "";
      let textY = y;

      chars.forEach(char => {
        const testLine = line + char;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > maxWidth) {
          page.drawText(line, { x, y: textY, size: fontSize, font });
          line = char;
          textY -= lineHeight;
        } else {
          line = testLine;
        }
      });

      if (line) {
        page.drawText(line, { x, y: textY, size: fontSize, font });
        textY -= lineHeight;
      }

      return textY;
    }

    const contractText = `
一、委任期間：自簽約日起三十日止，經雙方書面同意得延展。

二、報酬：約定於撥款後，扣除銀行或融資機構內扣費用後，依核准金額之15%支付乙方顧問服務費，另付諮詢作業費新台幣3,500元整。

三、違約：違約金50,000元，仍須支付服務費。

四、文件與保密：資料需真實，並負保密責任。

五、聯徵查詢：同意查詢信用資料。

六、契約變更終止：須書面同意。

七、簽署方式：通訊簽署等同親簽。
`;

    let textY = contractY + contractH - 20;
    contractText.split("\n").forEach(line => {
      if (line.trim()) {
        textY = drawWrappedText(page, line.trim(), contractX + 10, textY, contractW - 20, font, 12, 18);
        textY -= 8; // 段落間距
      }
    });

    // ⭐ 簽名
    const sigBytes = Buffer.from(signature.split(",")[1], "base64");
    const sigImage = await pdfDoc.embedPng(sigBytes);

    page.drawImage(sigImage, {
      x: 100,
      y: contractY - 120,
      width: 400,
      height: 100
    });

    // ⭐ 儲存 PDF
    const pdfBytes = await pdfDoc.save();
    const fileName = `${Date.now()}_${name}.pdf`;
    const filePath = path.join(signDir, fileName);

    fs.writeFileSync(filePath, pdfBytes);

    res.json({ ok: true, file: fileName });

    // ⭐ 寄信（背景）
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const sendTo = email || process.env.EMAIL_USER;

      (async () => {
        try {
          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASS
            }
          });

          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: sendTo,
            subject: "合約PDF",
            text: "您的合約PDF已附上",
            attachments: [{ filename: fileName, path: filePath }]
          });

          console.log("📩 已寄出");
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

/* =========================
   ⭐ Render port
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
