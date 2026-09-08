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
 * IDENTITY MODEL
 * This script is published as TWO web app deployments of the same code:
 *
 *   App  - "Execute as: User accessing the web app", access "Anyone with a
 *          Google Account". Google signs the person in before the page loads,
 *          so Session.getActiveUser() tells us who they are. Restaurant staff
 *          use this URL. It holds no access to the spreadsheet.
 *
 *   API  - "Execute as: Me", access "Anyone". Receives requests from App over
 *          UrlFetchApp, checks the caller's email against the Restaurants tab,
 *          and does all spreadsheet and Gmail work under the admin's account.
 *
 * The two deployments recognise each other with a shared secret kept in Script
 * Properties (API_URL and API_SECRET), so restaurants never need access to the
 * spreadsheet and orders are always emailed from the admin's Gmail.
 *
 * See ../SETUP.md for the full deployment walkthrough.
 */

var SHEET_NAMES = {
  SETTINGS: 'Settings',
  RESTAURANTS: 'Restaurants',
  ITEMS: 'Items',
  ORDERS: 'Orders'
};

var DELIVERY_WEEKDAYS = [3, 5]; // Wednesday, Friday (Sunday = 0)
var UPCOMING_DELIVERY_COUNT = 4;

var PROP_API_URL = 'API_URL';
var PROP_API_SECRET = 'API_SECRET';

// ===========================================================================
// APP SIDE - runs as the restaurant user, has no spreadsheet access
// ===========================================================================

function doGet() {
  // The API deployment runs as the admin, so nobody is "signed in" there and
  // this guard stops that URL from ever serving the ordering screen.
  if (!getActiveUserEmail_()) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:Arial,sans-serif;padding:24px;">This URL is the CKOA API endpoint, not the app. ' +
      'Please use the app link your administrator gave you.</p>'
    );
  }
  var template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = 'Central Kitchen Ordering';
  return template
    .evaluate()
    .setTitle('Central Kitchen Ordering')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * The Google account viewing the page. Deliberately does NOT fall back to
 * getEffectiveUser(): on the API deployment that would return the admin and
 * let an anonymous visitor act as them.
 */
function getActiveUserEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

function callApi_(action, data) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty(PROP_API_URL);
  var secret = props.getProperty(PROP_API_SECRET);
  if (!url || !secret) {
    throw new Error('This app is not finished being set up (API_URL / API_SECRET are missing). Please contact your administrator.');
  }

  var email = getActiveUserEmail_();
  if (!email) {
    throw new Error('We could not tell which Google account you are signed in with. Please reload the page and try again.');
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ secret: secret, email: email, action: action, data: data || {} }),
    muteHttpExceptions: true,
    followRedirects: true
  });

  var result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (err) {
    throw new Error('The server sent back an unexpected response. Please contact your administrator.');
  }
  if (!result.ok) throw new Error(result.message || 'Something went wrong.');
  return result.data;
}

// Client-callable wrappers used by google.script.run.
function getOrderPageData() { return callApi_('getOrderPageData'); }
function submitOrder(order) { return callApi_('submitOrder', order); }
function getMyOrders() { return callApi_('getMyOrders'); }

// ===========================================================================
// API SIDE - runs as the admin, owns the spreadsheet and sends the email
// ===========================================================================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty(PROP_API_SECRET);
    if (!secret || body.secret !== secret) {
      return jsonOutput_({ ok: false, message: 'Unauthorised request.' });
    }

    var email = String(body.email || '').trim().toLowerCase();
    var restaurant = findRestaurantByEmail_(email);
    if (!restaurant) {
      return jsonOutput_({
        ok: false,
        message: email + ' is not registered. Please ask your administrator to add this account to the restaurant list.'
      });
    }

    var data;
    switch (body.action) {
      case 'getOrderPageData': data = apiOrderPageData_(restaurant); break;
      case 'submitOrder': data = apiSubmitOrder_(restaurant, body.data || {}); break;
      case 'getMyOrders': data = apiMyOrders_(restaurant); break;
      default: return jsonOutput_({ ok: false, message: 'Unknown action.' });
    }
    return jsonOutput_({ ok: true, data: data });
  } catch (err) {
    return jsonOutput_({ ok: false, message: err.message || String(err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this once from the editor to create the shared secret, then copy the
 * value it logs into the API_SECRET script property of the same project.
 */
function generateApiSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(PROP_API_SECRET);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(PROP_API_SECRET, secret);
    Logger.log('Created API_SECRET.');
  } else {
    Logger.log('API_SECRET already exists.');
  }
  Logger.log('API_URL is currently: ' + (props.getProperty(PROP_API_URL) || '(not set yet)'));
  return secret;
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

/** The Restaurants tab is the allow-list: no row, no access. */
function findRestaurantByEmail_(email) {
  if (!email) return null;
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

function apiOrderPageData_(restaurant) {
  return {
    appTitle: getConfig_().appTitle,
    restaurant: restaurant,
    items: getActiveItems_(),
    deliveryDates: getUpcomingDeliveryDates_()
  };
}

// ---------------------------------------------------------------------------
// Order submission
// ---------------------------------------------------------------------------

function apiSubmitOrder_(restaurant, order) {
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
  var ordererName = String(order.ordererName).trim();

  // Send first: if Gmail rejects the message there is no order, so the sheet
  // never ends up holding a row the kitchen has not actually been told about.
  sendOrderEmail_({
    orderId: orderId,
    restaurant: restaurant,
    ordererName: ordererName,
    deliveryDate: order.deliveryDate,
    deliveryLabel: selectedDate.label,
    deliveryAddress: address,
    lineItems: lineItems,
    total: total
  });

  getSheet_(SHEET_NAMES.ORDERS).appendRow([
    orderId,
    new Date(),
    restaurant.email,
    restaurant.name,
    ordererName,
    order.deliveryDate,
    address,
    JSON.stringify(lineItems),
    total,
    'Sent'
  ]);

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
// Order history for the signed-in restaurant
// ---------------------------------------------------------------------------

function apiMyOrders_(restaurant) {
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
