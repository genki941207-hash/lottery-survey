# =============================================================
# 彩券問卷：資料前處理
# 把網站回覆（Google 試算表下載的 CSV）轉成組員模型要的 raw_df 格式
#
# 使用方式：
#   1. 在試算表的 responses 工作表：檔案 → 下載 → 逗號分隔值 (.csv)
#   2. 檔名改成 responses.csv，放在 R 的工作目錄
#   3. 執行本檔，得到 raw_df（欄位與組員模擬資料完全相同）
#   4. 在組員的程式中，把「2. 模擬/讀取問卷原始資料」那段
#      set.seed(2026) ... raw_df <- tibble(...) 整段刪掉，改成 source("prepare_data.R")
# =============================================================

library(tidyverse)

# ---------- 選項對照 ----------
# 第 1、2 題：方案一 = A、方案二 = B、都不想買 = None
recode_choice <- function(x) case_when(
  str_detect(x, "方案一") ~ "A",
  str_detect(x, "方案二") ~ "B",
  str_detect(x, "不想買") ~ "None",
  TRUE ~ NA_character_
)

# 第 8 題：每月可自由支配金額 → 1～4（文字必須與問卷選項完全一致）
income_levels <- c(
  "5,000 元以下",
  "5,001 ～ 15,000 元",
  "15,001 ～ 30,000 元",
  "30,001 元以上"
)

# ---------- 讀檔與清理 ----------
df <- read_csv("responses.csv",
               col_types = cols(.default = col_character())) %>%   # 全部先讀成文字，避免「5,000」被當數字
  filter(source == "web") %>%                 # 排除測試資料（source = test）
  arrange(timestamp) %>%                      # 依時間排序，重複填答時保留第一次
  distinct(client_id, .keep_all = TRUE) %>%   # 同一裝置只留一筆
  mutate(
    id           = row_number(),
    Q1_choice    = recode_choice(Q1_1),
    Q2_choice    = recode_choice(Q2_1),
    Q1_spend     = as.numeric(Q1_2),          # 1-2 願付金額（元）；選 None 者為 0
    Q2_spend     = as.numeric(Q2_2),          # 2-2 願付金額（元）；選 None 者為 0
    stat_edu     = as.integer(Q9 != "完全沒有"),        # 1 = 修過基礎課程或非常熟悉
    risk_love    = as.integer(str_detect(Q5, "50%")),  # 1 = 第 5 題選「50% 機率拿 2,500 元」
    income       = match(Q8, income_levels),           # 1 = 最低，4 = 最高
    duration_sec = as.numeric(duration_sec)
  )

# （選用）排除作答過快的人，門檻請看 duration_sec 的分布再決定
# df <- df %>% filter(duration_sec >= 45)

# ---------- 檢查：有對應不到的值就提醒 ----------
bad <- df %>% filter(is.na(Q1_choice) | is.na(Q2_choice) | is.na(income) |
                     is.na(Q1_spend) | is.na(Q2_spend))
if (nrow(bad) > 0) {
  warning(nrow(bad), " 筆資料有欄位對應不到（可能是選項文字被改過），請檢查 bad")
}

# ---------- 輸出成組員模型用的格式 ----------
raw_df <- df %>%
  select(id, Q1_choice, Q1_spend, Q2_choice, Q2_spend, stat_edu, risk_love, income)

cat("有效樣本數：", nrow(raw_df), "\n")
print(count(raw_df, Q1_choice))
print(count(raw_df, Q2_choice))
