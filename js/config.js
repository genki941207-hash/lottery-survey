// ===== 網站設定（部署後只需要改這個檔案） =====
window.CONFIG = {
  // Apps Script 部署後拿到的網址（結尾是 /exec）。留空 = 示範模式（不會真的送出，統計為假資料）
  API_URL: 'https://script.google.com/macros/s/AKfycbyuQ7_bhM2Fvd2uIlFFbAf5qEYwlpg5iW60Jv2E1rbxT7txa6SShn6RWqVf5MdEcVJr/exec',

  // 結果頁是否顯示各題期望值解說（顯示較有趣、但截圖外流可能影響尚未作答者）
  SHOW_INSIGHTS: true,

  // 尚未作答者能否在首頁看到統計圖表（建議 false：先看到大家的答案會影響作答）
  STATS_PUBLIC_BEFORE_SUBMIT: false,

  // 同一裝置填過後只顯示結果（自己測試時可改 false）
  ONE_RESPONSE_PER_DEVICE: true
};
