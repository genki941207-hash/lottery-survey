// ===== 網站設定（部署後只需要改這個檔案） =====
window.CONFIG = {
  // Apps Script 部署後拿到的網址（結尾是 /exec）。留空 = 示範模式（不會真的送出，統計為假資料）
  API_URL: 'https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnT9z7rp1yaOOpZIM15NI6QsrD38NzU8bjH0kIKMo1vpogQNnXelMuAoxEfxIIPitNmDssDm43Vhm0kEiPZon4rH0WMrEeWxarP9rrWaOB8wksJRKxnn9YAnM6vuifyUBBt6ymbpyaECqpCPnMP_KIjayfzHNdP47Cr7ttaK3v4gq16iCMrnWh-JSZ_NnPaa7_Mvs46_5DtoGgIUEUX5MGCA683wmFKAnfDNNJqvSE-T-mNv7u18v8nxlaAw2wy0yKT84dclP_iBdlPa7S232oA42jMRLQ&lib=M3JlKS4yKMEnyZJ2CRrY2yVY-IZcfP7n5',

  // 結果頁是否顯示各題期望值解說（顯示較有趣、但截圖外流可能影響尚未作答者）
  SHOW_INSIGHTS: true,

  // 尚未作答者能否在首頁看到統計圖表（建議 false：先看到大家的答案會影響作答）
  STATS_PUBLIC_BEFORE_SUBMIT: false,

  // 同一裝置填過後只顯示結果（自己測試時可改 false）
  ONE_RESPONSE_PER_DEVICE: true
};
