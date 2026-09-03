/**
 * CKOA - Central Kitchen Ordering App
 *
 * Bound Apps Script for an admin-owned Google Sheet with four tabs:
 *   Settings    | Key | Value |
 *   Restaurants | Email | RestaurantName | DeliveryAddress | Active |
 *   Items       | ID | Category | Name | Unit | Price | Active |
 *   Orders      | OrderID | Timestamp | RestaurantEmail | RestaurantName |
 *               | OrdererName | DeliveryDate | DeliveryAddress | ItemsJSON |
 *               | Total | Status |
 *
 * See ../SETUP.md for how to create the sheet, deploy this as a web app,
 * and configure the Google Sign-In client ID.
 */

var SHEET_NAMES = {
  SETTINGS: 'Settings',
  RESTAURANTS: 'Restaurants',
  ITEMS: 'Items',
  ORDERS: 'Orders'
};

var DELIVERY_WEEKDAYS = [3, 5]; // Wednesday, Friday (Sunday = 0)
var UPCOMING_DELIVERY_COUNT = 4;

// ---------------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------------

function doGet() {
  var config = getConfig_();
  var template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = config.appTitle || 'Central Kitchen Ordering';
  template.googleClientId = config.googleClientId || '';
  return template
    .evaluate()
    .setTitle(config.appTitle || 'Central Kitchen Ordering')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------------------------------------------------------------------------
// Config / sheet helpers
// ---------------------------------------------------------------------------

function getConfig_() {
  var sheet = getSheet_(SHEET_NAMES.SETTINGS);
  var values = sheet.getDataRange().getValues();
  var config = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (!key) continue;
    config[key] = values[i][1];
  }
  return {
    appTitle: config.AppTitle || 'Central Kitchen Ordering',
    googleClientId: config.GoogleClientId || '',
    centralKitchenEmail: config.CentralKitchenEmail || '',
    orderCutoffHour: config.OrderCutoffHour !== undefined && config.OrderCutoffHour !== ''
      ? Number(config.OrderCutoffHour)
      : 9
  };
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Missing sheet tab: ' + name + '. See SETUP.md.');
  }
  return sheet;
}

function sheetRowsAsObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue; // skip blank rows
    var obj = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    rows.push(obj);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Auth: verify a Google Identity Services ID token, then match it against
// the Restaurants tab. This works for any Google account (personal or
// Workspace) since it does not rely on Apps Script's own session auth.
// ---------------------------------------------------------------------------

function verifyIdToken_(idToken) {
  if (!idToken) throw new Error('Thiếu thông tin đăng nhập.');
  var config = getConfig_();
  var response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
  }
  var payload = JSON.parse(response.getContentText());
  if (config.googleClientId && payload.aud !== config.googleClientId) {
    throw new Error('Đăng nhập không hợp lệ (sai ứng dụng).');
  }
  if (!payload.email || payload.email_verified === 'false' || payload.email_verified === false) {
    throw new Error('Tài khoản Google chưa xác thực email.');
  }
  return { email: String(payload.email).toLowerCase(), name: payload.name || payload.email };
}

function findRestaurantByEmail_(email) {
  var rows = sheetRowsAsObjects_(getSheet_(SHEET_NAMES.RESTAURANTS));
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.Email || '').trim().toLowerCase() === email && String(r.Active).toUpperCase() !== 'FALSE') {
      return {
        email: email,
        name: r.RestaurantName,
        address: r.DeliveryAddress || ''
      };
    }
  }
  return null;
}

function authenticateRestaurant_(idToken) {
  var identity = verifyIdToken_(idToken);
  var restaurant = findRestaurantByEmail_(identity.email);
  if (!restaurant) {
    throw new Error(
      'Tài khoản ' + identity.email + ' chưa được đăng ký. Vui lòng liên hệ quản trị viên để được thêm vào danh sách nhà hàng.'
    );
  }
  return restaurant;
}

/**
 * Client-callable: verify login and return the restaurant profile.
 */
function authenticate(idToken) {
  try {
    var restaurant = authenticateRestaurant_(idToken);
    return { ok: true, restaurant: restaurant };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ---------------------------------------------------------------------------
// Catalog + delivery dates
// ---------------------------------------------------------------------------

function getActiveItems_() {
  var sheet = getSheet_(SHEET_NAMES.ITEMS);
  var rows = sheetRowsAsObjects_(sheet);
  var items = [];
  var needsIdWrite = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.Name) continue;
    if (String(r.Active).toUpperCase() === 'FALSE') continue;
    if (!r.ID) {
      r.ID = 'IT' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyMMddHHmmss') + i;
      sheet.getRange(r._row, 1).setValue(r.ID);
      needsIdWrite = true;
    }
    items.push({
      id: String(r.ID),
      category: r.Category || 'Khác',
      name: r.Name,
      unit: r.Unit || '',
      price: Number(r.Price) || 0
    });
  }
  return items;
}

function getUpcomingDeliveryDates_() {
  var config = getConfig_();
  var tz = 'Asia/Ho_Chi_Minh';
  var now = new Date();
  var cutoffHour = isNaN(config.orderCutoffHour) ? 9 : config.orderCutoffHour;
  var dates = [];
  var cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  for (var d = 0; dates.length < UPCOMING_DELIVERY_COUNT && d < 60; d++) {
    var check = new Date(cursor.getTime() + d * 86400000);
    if (DELIVERY_WEEKDAYS.indexOf(check.getDay()) === -1) continue;
    var isToday = d === 0;
    if (isToday && now.getHours() >= cutoffHour) continue; // past cutoff, skip today
    dates.push({
      iso: Utilities.formatDate(check, tz, 'yyyy-MM-dd'),
      label: Utilities.formatDate(check, tz, 'EEEE, dd/MM/yyyy')
    });
  }
  return dates;
}

/**
 * Client-callable: single call that returns everything the order page needs.
 */
function getOrderPageData(idToken) {
  var restaurant = authenticateRestaurant_(idToken);
  return {
    restaurant: restaurant,
    items: getActiveItems_(),
    deliveryDates: getUpcomingDeliveryDates_()
  };
}

// ---------------------------------------------------------------------------
// Order submission
// ---------------------------------------------------------------------------

function submitOrder(idToken, order) {
  var restaurant = authenticateRestaurant_(idToken);

  if (!order || !order.items || !order.items.length) {
    throw new Error('Giỏ hàng đang trống.');
  }
  if (!order.ordererName || !String(order.ordererName).trim()) {
    throw new Error('Vui lòng nhập tên người đặt.');
  }
  if (!order.deliveryDate) {
    throw new Error('Vui lòng chọn ngày giao hàng.');
  }
  var validDates = getUpcomingDeliveryDates_().map(function (d) { return d.iso; });
  if (validDates.indexOf(order.deliveryDate) === -1) {
    throw new Error('Ngày giao hàng không hợp lệ. Vui lòng chọn lại.');
  }
  var address = (order.deliveryAddress && String(order.deliveryAddress).trim()) || restaurant.address;
  if (!address) {
    throw new Error('Vui lòng nhập địa chỉ giao hàng.');
  }

  var catalog = {};
  getActiveItems_().forEach(function (it) { catalog[it.id] = it; });

  var lineItems = [];
  var total = 0;
  order.items.forEach(function (line) {
    var product = catalog[line.id];
    var qty = Number(line.qty) || 0;
    if (!product || qty <= 0) return;
    var lineTotal = product.price * qty;
    total += lineTotal;
    lineItems.push({
      id: product.id,
      name: product.name,
      unit: product.unit,
      price: product.price,
      qty: qty,
      lineTotal: lineTotal
    });
  });
  if (!lineItems.length) {
    throw new Error('Giỏ hàng không có món hợp lệ.');
  }

  var orderId = 'ORD' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyMMdd-HHmmss');
  var deliveryLabel = validDates.length
    ? (getUpcomingDeliveryDates_().filter(function (d) { return d.iso === order.deliveryDate; })[0] || {}).label
    : order.deliveryDate;

  var ordersSheet = getSheet_(SHEET_NAMES.ORDERS);
  ordersSheet.appendRow([
    orderId,
    new Date(),
    restaurant.email,
    restaurant.name,
    String(order.ordererName).trim(),
    order.deliveryDate,
    address,
    JSON.stringify(lineItems),
    total,
    'Đã gửi'
  ]);

  sendOrderEmail_({
    orderId: orderId,
    restaurant: restaurant,
    ordererName: String(order.ordererName).trim(),
    deliveryDate: order.deliveryDate,
    deliveryLabel: deliveryLabel || order.deliveryDate,
    deliveryAddress: address,
    lineItems: lineItems,
    total: total
  });

  return { ok: true, orderId: orderId, total: total };
}

function sendOrderEmail_(data) {
  var config = getConfig_();
  if (!config.centralKitchenEmail) {
    throw new Error('Chưa cấu hình email bếp trung tâm (CentralKitchenEmail) trong sheet Settings.');
  }

  var subject = '[' + data.restaurant.name + '] Đơn đặt hàng bếp trung tâm - Giao ' + data.deliveryLabel;

  var textLines = [];
  textLines.push('Nhà hàng: ' + data.restaurant.name);
  textLines.push('Người đặt: ' + data.ordererName);
  textLines.push('Ngày giao: ' + data.deliveryLabel);
  textLines.push('Địa chỉ giao: ' + data.deliveryAddress);
  textLines.push('');
  textLines.push('Danh sách món:');
  data.lineItems.forEach(function (li) {
    textLines.push('- ' + li.name + ' x' + li.qty + ' ' + li.unit + ' = ' + formatCurrency_(li.lineTotal));
  });
  textLines.push('');
  textLines.push('Tổng cộng: ' + formatCurrency_(data.total));
  textLines.push('');
  textLines.push('Mã đơn: ' + data.orderId);
  textLines.push('--');
  textLines.push(data.ordererName);
  textLines.push(data.restaurant.name);
  var body = textLines.join('\n');

  var rowsHtml = data.lineItems
    .map(function (li) {
      return (
        '<tr>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #eee;">' + escapeHtml_(li.name) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">' + li.qty + ' ' + escapeHtml_(li.unit) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">' + formatCurrency_(li.lineTotal) + '</td>' +
        '</tr>'
      );
    })
    .join('');

  var htmlBody =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;">' +
    '<p><strong>Nhà hàng:</strong> ' + escapeHtml_(data.restaurant.name) + '<br>' +
    '<strong>Người đặt:</strong> ' + escapeHtml_(data.ordererName) + '<br>' +
    '<strong>Ngày giao:</strong> ' + escapeHtml_(data.deliveryLabel) + '<br>' +
    '<strong>Địa chỉ giao:</strong> ' + escapeHtml_(data.deliveryAddress) + '</p>' +
    '<table style="border-collapse:collapse;width:100%;max-width:480px;">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Món</th>' +
    '<th style="text-align:center;padding:4px 8px;border-bottom:2px solid #333;">SL</th>' +
    '<th style="text-align:right;padding:4px 8px;border-bottom:2px solid #333;">Thành tiền</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
    '<tfoot><tr><td colspan="2" style="padding:6px 8px;text-align:right;"><strong>Tổng cộng</strong></td>' +
    '<td style="padding:6px 8px;text-align:right;"><strong>' + formatCurrency_(data.total) + '</strong></td></tr></tfoot>' +
    '</table>' +
    '<p style="margin-top:16px;color:#555;">Mã đơn: ' + escapeHtml_(data.orderId) + '</p>' +
    '<p>--<br>' + escapeHtml_(data.ordererName) + '<br>' + escapeHtml_(data.restaurant.name) + '</p>' +
    '</div>';

  GmailApp.sendEmail(config.centralKitchenEmail, subject, body, {
    htmlBody: htmlBody,
    cc: data.restaurant.email,
    name: data.restaurant.name + ' - CKOA'
  });
}

function formatCurrency_(n) {
  return Number(n || 0).toLocaleString('vi-VN') + 'đ';
}

function escapeHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------------------
// Order history for the logged-in restaurant
// ---------------------------------------------------------------------------

function getMyOrders(idToken) {
  var restaurant = authenticateRestaurant_(idToken);
  var rows = sheetRowsAsObjects_(getSheet_(SHEET_NAMES.ORDERS));
  var mine = rows.filter(function (r) {
    return String(r.RestaurantEmail || '').toLowerCase() === restaurant.email;
  });
  mine.sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return mine.slice(0, 20).map(function (r) {
    var items = [];
    try { items = JSON.parse(r.ItemsJSON || '[]'); } catch (e) { items = []; }
    return {
      orderId: r.OrderID,
      timestamp: Utilities.formatDate(new Date(r.Timestamp), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm'),
      deliveryDate: r.DeliveryDate,
      items: items,
      total: r.Total,
      status: r.Status
    };
  });
}
