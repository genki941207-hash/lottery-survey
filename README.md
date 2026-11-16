# 彩券直覺小測驗（彩券購買決策調查網站）

靜態網站（部署在 Vercel）+ Google Apps Script 後端 + Google 試算表資料庫。

- 完整計畫、部署步驟、資料格式：見 [`docs/PLAN.md`](docs/PLAN.md)
- 網站設定：`js/config.js`（`API_URL` 留空 = 示範模式）
- 後端程式：`apps-script/Code.gs`（貼到試算表的 Apps Script，不會部署到 Vercel）

本機預覽：

```bash
python3 -m http.server 8000
# 打開 http://localhost:8000
```

⚠️ 題目選項文字不可更動（經濟學模型要用），`js/questions.js` 與 `apps-script/Code.gs` 兩邊必須一致。
