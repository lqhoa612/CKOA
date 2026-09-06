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
    // Order cut-off: OrderCutoffHour o'clock, OrderCutoffDaysBefore days ahead
    // of the delivery date. Default: 4pm the day before.
    orderCutoffHour: numberOr_(config.OrderCutoffHour, 16),
    orderCutoffDaysBefore: numberOr_(config.OrderCutoffDaysBefore, 1)
  };
}

function numberOr_(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  var n = Number(value);
  return isNaN(n) ? fallback : n;
}

/** Time zone comes from appsscript.json - change it there to change the app. */
function getTimeZone_() {
  return Session.getScriptTimeZone();
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
  if (!idToken) throw new Error('Missing sign-in details.');
  var config = getConfig_();
  var response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Your sign-in is invalid or has expired. Please sign in again.');
  }
  var payload = JSON.parse(response.getContentText());
  if (config.googleClientId && payload.aud !== config.googleClientId) {
    throw new Error('This sign-in was issued for a different app.');
  }
  if (!payload.email || payload.email_verified === 'false' || payload.email_verified === false) {
    throw new Error('This Google account does not have a verified email address.');
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
      identity.email + ' is not registered. Please ask your administrator to add this account to the restaurant list.'
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
// Catalogue + delivery dates
// ---------------------------------------------------------------------------

function getActiveItems_() {
  var sheet = getSheet_(SHEET_NAMES.ITEMS);
  var rows = sheetRowsAsObjects_(sheet);
  var items = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.Name) continue;
    if (String(r.Active).toUpperCase() === 'FALSE') continue;
    if (!r.ID) {
      r.ID = 'IT' + Utilities.formatDate(new Date(), getTimeZone_(), 'yyMMddHHmmss') + i;
      sheet.getRange(r._row, 1).setValue(r.ID);
    }
    items.push({
      id: String(r.ID),
      category: r.Category || 'Other',
      name: r.Name,
      unit: r.Unit || '',
      price: Number(r.Price) || 0
    });
  }
  return items;
}

/**
 * A delivery date is available when it is an upcoming Wednesday/Friday whose
 * cut-off has not passed. The cut-off for a delivery date is OrderCutoffHour
 * o'clock, OrderCutoffDaysBefore days earlier (default: 4pm the day before).
 */
function getUpcomingDeliveryDates_() {
  var config = getConfig_();
  var tz = getTimeZone_();
  var now = new Date();
  var dates = [];

  for (var d = 0; dates.length < UPCOMING_DELIVERY_COUNT && d < 60; d++) {
    var check = addDays_(now, d);
    if (DELIVERY_WEEKDAYS.indexOf(check.getDay()) === -1) continue;
    var deadline = cutoffDeadlineFor_(check, config);
    if (now.getTime() >= deadline.getTime()) continue; // cut-off has passed
    dates.push({
      iso: Utilities.formatDate(check, tz, 'yyyy-MM-dd'),
      label: Utilities.formatDate(check, tz, 'EEEE, dd/MM/yyyy'),
      deadlineLabel: Utilities.formatDate(deadline, tz, 'h:mma EEE dd/MM').replace('AM', 'am').replace('PM', 'pm')
    });
  }
  return dates;
}

function cutoffDeadlineFor_(deliveryDate, config) {
  return new Date(
    deliveryDate.getFullYear(),
    deliveryDate.getMonth(),
    deliveryDate.getDate() - config.orderCutoffDaysBefore,
    config.orderCutoffHour, 0, 0, 0
  );
}

/**
 * Add days by calendar, not by milliseconds, so the result does not drift
 * across daylight saving changes - Hobart's changeover days are 23 or 25
 * hours long. Always returns local midnight of the target day.
 */
function addDays_(from, days) {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, 0, 0, 0, 0);
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
    throw new Error('Your cart is empty.');
  }
  if (!order.ordererName || !String(order.ordererName).trim()) {
    throw new Error('Please enter your name.');
  }
  if (!order.deliveryDate) {
    throw new Error('Please choose a delivery date.');
  }
  var availableDates = getUpcomingDeliveryDates_();
  var selectedDate = availableDates.filter(function (d) { return d.iso === order.deliveryDate; })[0];
  if (!selectedDate) {
    var cutoffConfig = getConfig_();
    throw new Error(
      'Ordering has closed for that delivery date (cut-off is ' + formatHour_(cutoffConfig.orderCutoffHour) +
      ', ' + cutoffConfig.orderCutoffDaysBefore + ' day(s) before delivery). Please choose another date.'
    );
  }
  var address = (order.deliveryAddress && String(order.deliveryAddress).trim()) || restaurant.address;
  if (!address) {
    throw new Error('Please enter a delivery address.');
  }

  var catalogue = {};
  getActiveItems_().forEach(function (it) { catalogue[it.id] = it; });

  var lineItems = [];
  var total = 0;
  order.items.forEach(function (line) {
    var product = catalogue[line.id];
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
    throw new Error('Your cart has no valid items.');
  }

  var orderId = 'ORD' + Utilities.formatDate(new Date(), getTimeZone_(), 'yyMMdd-HHmmss');
  var deliveryLabel = selectedDate.label;

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
    'Sent'
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
    throw new Error('The central kitchen email (CentralKitchenEmail) is not set in the Settings tab.');
  }

  var subject = '[' + data.restaurant.name + '] Central kitchen order - delivery ' + data.deliveryLabel;

  var textLines = [];
  textLines.push('Restaurant: ' + data.restaurant.name);
  textLines.push('Ordered by: ' + data.ordererName);
  textLines.push('Delivery date: ' + data.deliveryLabel);
  textLines.push('Delivery address: ' + data.deliveryAddress);
  textLines.push('');
  textLines.push('Items:');
  data.lineItems.forEach(function (li) {
    textLines.push('- ' + li.name + ' x' + li.qty + ' ' + li.unit + ' = ' + formatCurrency_(li.lineTotal));
  });
  textLines.push('');
  textLines.push('Total: ' + formatCurrency_(data.total));
  textLines.push('');
  textLines.push('Order ref: ' + data.orderId);
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
    '<p><strong>Restaurant:</strong> ' + escapeHtml_(data.restaurant.name) + '<br>' +
    '<strong>Ordered by:</strong> ' + escapeHtml_(data.ordererName) + '<br>' +
    '<strong>Delivery date:</strong> ' + escapeHtml_(data.deliveryLabel) + '<br>' +
    '<strong>Delivery address:</strong> ' + escapeHtml_(data.deliveryAddress) + '</p>' +
    '<table style="border-collapse:collapse;width:100%;max-width:480px;">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Item</th>' +
    '<th style="text-align:center;padding:4px 8px;border-bottom:2px solid #333;">Qty</th>' +
    '<th style="text-align:right;padding:4px 8px;border-bottom:2px solid #333;">Amount</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
    '<tfoot><tr><td colspan="2" style="padding:6px 8px;text-align:right;"><strong>Total</strong></td>' +
    '<td style="padding:6px 8px;text-align:right;"><strong>' + formatCurrency_(data.total) + '</strong></td></tr></tfoot>' +
    '</table>' +
    '<p style="margin-top:16px;color:#555;">Order ref: ' + escapeHtml_(data.orderId) + '</p>' +
    '<p>--<br>' + escapeHtml_(data.ordererName) + '<br>' + escapeHtml_(data.restaurant.name) + '</p>' +
    '</div>';

  GmailApp.sendEmail(config.centralKitchenEmail, subject, body, {
    htmlBody: htmlBody,
    cc: data.restaurant.email,
    name: data.restaurant.name + ' - CKOA'
  });
}

/** Australian dollars, e.g. 1234.5 -> "$1,234.50". */
function formatCurrency_(n) {
  var num = Number(n);
  if (isNaN(num)) num = 0;
  var parts = Math.abs(num).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (num < 0 ? '-$' : '$') + parts.join('.');
}

/** 16 -> "4pm", 9 -> "9am", 0 -> "12am". */
function formatHour_(hour) {
  var h = Number(hour) || 0;
  var suffix = h < 12 ? 'am' : 'pm';
  var display = h % 12;
  if (display === 0) display = 12;
  return display + suffix;
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
      timestamp: Utilities.formatDate(new Date(r.Timestamp), getTimeZone_(), 'dd/MM/yyyy HH:mm'),
      deliveryDate: r.DeliveryDate,
      items: items,
      total: r.Total,
      status: r.Status
    };
  });
}
