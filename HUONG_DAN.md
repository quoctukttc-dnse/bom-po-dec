# Decathlon — Mapping màu & size theo danh sách chuẩn hoá (ScaX → ScaF)

## Cấu trúc thư mục (đẩy nguyên trạng lên GitHub)

```
index.html          ← giao diện
app.js              ← toàn bộ logic
libs/               ← 3 thư viện JS (xlsx, exceljs, pako)
data/               ← master data nhúng sẵn (.json.gz)
  deca_npl.json.gz  ← Chuẩn hoá NPL (Mau_cu_Mau_moi, bản DAYDU 17/07) — 10.154 dòng
  deca_tp.json.gz   ← Chuẩn hoá Thành phẩm — 7.922 dòng
  colors.json.gz    ← Color Library
  generic.json.gz   ← Material Items (Generic)
  sku.json.gz       ← Material Items (SKU)
  customers.json.gz ← Khách hàng
  suppliers.json.gz ← Supplier Profile
  ms.json.gz        ← Danh sách MS
  deca_fix.json.gz  ← DS làm sạch model code khỏi màu TP — 895 cặp (product, model)
```

Cách deploy: tạo repo GitHub mới (hoặc đè lên repo cũ) → upload toàn bộ →
Settings → Pages → deploy từ branch chính. Mở trang là dùng được ngay.

## Công cụ làm gì

Tự nhận diện loại file khi upload:

- **File Import PO** (có cột `OldItem`, `ColorItemOld`…): điền `Item`,
  `ColorItem`, `RMSize`, chuẩn hoá `MS`. **Cột `Lapdip` giữ nguyên, không đụng.**
- **File BOM** (có cột `ProductCodeOld`, `ColorProductOld`…): điền
  `ProductCode`, `ColorProduct` (thành phẩm), `Item`, `ColorItem`, `RMSize`
  (nguyên phụ liệu), kiểm tra `ProductSize`.

## Thứ tự dò tìm

1. **Danh sách chuẩn hoá Decathlon trước** — khớp theo (ưu tiên từ trên xuống):
   1. Mã số màu / Item code Decathlon trong chuỗi màu cũ (vd `4638230`, `4931985`)
   2. Trùng nguyên chuỗi Màu CŨ
   3. Chuỗi chứa nhau (phần khớp dài nhất)
   4. Model / DSM (chỉ NPL)
   - Nếu ra nhiều Màu MỚI khác nhau → thu hẹp bằng phần chữ của màu, rồi bằng size.
   - Vẫn không duy nhất → **để trống + đưa vào báo cáo** (không đoán).
2. **Không có trong chuẩn hoá** → PO: dò master data như công cụ cũ
   (Generic theo supplier/customer, Color Library); BOM: để trống màu, chỉ dò Item.

Giá trị điền là **nguyên văn cột «Màu MỚI»** của danh sách chuẩn hoá.
Size: tìm thấy Size CŨ → ghi Size MỚI vào `RMSize`; không thấy → giữ nguyên +
báo cáo «Size ngoài chuẩn hoá».

## Báo cáo

Tab kết quả + file Excel báo cáo gồm: Tất cả dòng · Màu NPL ngoài chuẩn hoá ·
Màu TP ngoài chuẩn hoá (BOM) · Size ngoài chuẩn hoá · SKU cần tạo (PO) ·
MS cần kiểm tra (PO) · Không map được Item.

## Cập nhật danh sách chuẩn hoá / master

Tab **Cập nhật Master Data** → Upload file .xlsx đúng cấu trúc → dữ liệu lưu
trong trình duyệt (IndexedDB). Muốn mọi máy dùng bản mới: bấm
**Tải các file .json.gz** rồi upload đè vào thư mục `data/` trên GitHub.

## Làm sạch model code khỏi màu thành phẩm (BOM)

Danh sách «List Product code cần chỉnh lại loại model code ra khỏi màu» được
nhúng trong `data/deca_fix.json.gz` (gộp cả 3 sheet, cột C = Product code,
cột E = Model code). Khi xử lý file BOM:

- Product code thuộc danh sách + màu chứa đúng model code của nó →
  **loại model code khỏi màu rồi mới điền** vào `ColorProduct`
  (áp dụng cho cả giá trị «Màu MỚI» lấy từ chuẩn hoá).
- Product code thuộc danh sách nhưng KHÔNG có trong chuẩn hoá TP →
  vẫn làm sạch từ màu cũ và điền luôn (không để trống).
- Chỉ loại model code đăng ký cho đúng product code đó — không đụng số khác.

Các dòng đã làm sạch được liệt kê ở tab/sheet báo cáo «Đã làm sạch model code».

## Ghi chú bản cập nhật 18/07 (chiều)

- Danh mục chuẩn hoá NPL dùng bản **DAYDU 20260717** (10.154 dòng). Bộ nạp
  (cả admin upload) đọc theo **tên cột** nên chấp nhận cả layout cũ 11 cột
  lẫn layout mới có thêm «Đổi màu?», «Đổi size?», «Có trong Do SKU?».
- Import PO — cột màu: mọi trường hợp đều điền **tên màu (color name)**.
  Khớp chuẩn hoá → nguyên văn «Màu MỚI»; ngoài chuẩn hoá → tên màu dò được
  trong Color Library (mã màu chỉ ghi trong báo cáo/kiểm SKU, không điền vào file).
