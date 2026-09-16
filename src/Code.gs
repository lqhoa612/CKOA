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
var UPCOMING_DELIVERY_COUNT = 2;
var MAX_NOTES_LENGTH = 2000;
var KITCHEN_QUEUE_SCAN_ROWS = 300; // how far back the kitchen queue looks

var ADMIN_SCAN_ROWS = 500; // how far back the admin overview looks

var ROLE_KITCHEN = 'kitchen';
var ROLE_ADMIN = 'admin';
var STATUS_SENT = 'Sent';
var STATUS_INVOICED = 'Invoiced';

var PROP_API_URL = 'API_URL';
var PROP_API_SECRET = 'API_SECRET';

// ===========================================================================
// APP SIDE - runs as the restaurant user, has no spreadsheet access
// ===========================================================================

function doGet(e) {
  // Session.getActiveUser() is the reliable signal that a real person is
  // signed in, but it comes back blank for some consumer Gmail accounts even
  // on an "execute as user accessing" deployment. When that happens the app
  // link can carry ?app=1 to fall back to the effective user, which on this
  // deployment is still the visitor. The API deployment always runs as the
  // admin, so without that marker it refuses to serve the ordering screen.
  var active = readEmail_(function () { return Session.getActiveUser().getEmail(); });
  var effective = readEmail_(function () { return Session.getEffectiveUser().getEmail(); });
  var appMarker = !!(e && e.parameter && e.parameter.app === '1');

  if (!active && !(appMarker && effective)) {
    return HtmlService.createHtmlOutput(notTheAppHtml_(active, effective, appMarker));
  }

  var template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = 'Central Kitchen Ordering';
  // Needed so the page can offer "switch account" even when sign-in lands on
  // an unregistered address and the app itself never loads.
  template.signedInEmail = active || effective || '';
  try {
    template.appUrl = ScriptApp.getService().getUrl() || '';
  } catch (err) {
    template.appUrl = '';
  }
  return template
    .evaluate()
    .setTitle('Central Kitchen Ordering')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function readEmail_(getter) {
  try {
    return String(getter() || '').trim().toLowerCase();
  } catch (err) {
    return '';
  }
}

/**
 * Who is using the app. On the App deployment both of these resolve to the
 * visitor; the effective-user fallback is what keeps consumer Gmail accounts
 * working, since getActiveUser() comes back blank for some of them.
 */
function getSignedInEmail_() {
  return readEmail_(function () { return Session.getActiveUser().getEmail(); }) ||
    readEmail_(function () { return Session.getEffectiveUser().getEmail(); });
}

/** Shown when doGet cannot tell who is visiting - usually the API URL. */
function notTheAppHtml_(active, effective, appMarker) {
  var serviceUrl = '';
  try { serviceUrl = ScriptApp.getService().getUrl() || ''; } catch (err) { serviceUrl = '(unavailable)'; }

  return '<div style="font-family:Arial,sans-serif;padding:24px;max-width:640px;line-height:1.55;">' +
    '<p>This URL is the CKOA API endpoint, not the app. Please use the app link your administrator gave you.</p>' +
    '<p style="color:#666;font-size:13px;margin-top:24px;"><strong>Administrators</strong> &mdash; what this page can see:</p>' +
    '<ul style="color:#666;font-size:13px;">' +
    '<li>Active user: <code>' + (active ? escapeHtml_(active) : '(blank)') + '</code></li>' +
    '<li>Effective user: <code>' + (effective ? escapeHtml_(effective) : '(blank)') + '</code></li>' +
    '<li>?app=1 present: <code>' + (appMarker ? 'yes' : 'no') + '</code></li>' +
    '<li>This deployment&rsquo;s own URL:<br><code style="word-break:break-all;">' + escapeHtml_(serviceUrl) + '</code></li>' +
    '</ul>' +
    '<p style="color:#666;font-size:13px;">Compare that last URL with the <em>App</em> row in <em>Deploy &rarr; Manage ' +
    'deployments</em>. If it matches the <em>API</em> row instead, you are simply on the wrong link. If it matches the ' +
    'App row and both users are blank, this deployment is not running as the visitor &mdash; recreate it with ' +
    '<em>Execute as: User accessing the web app</em> and <em>Anyone with a Google Account</em>.</p>' +
    '</div>';
}

function callApi_(action, data) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty(PROP_API_URL);
  var secret = props.getProperty(PROP_API_SECRET);
  if (!url || !secret) {
    throw new Error('This app is not finished being set up (API_URL / API_SECRET are missing). Please contact your administrator.');
  }

  var email = getSignedInEmail_();
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
function getKitchenOrders() { return callApi_('getKitchenOrders'); }
function issueInvoice(payload) { return callApi_('issueInvoice', payload); }
function getAdminOrders() { return callApi_('getAdminOrders'); }

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
      case 'getKitchenOrders': data = apiKitchenOrders_(restaurant); break;
      case 'issueInvoice': data = apiIssueInvoice_(restaurant, body.data || {}); break;
      case 'getAdminOrders': data = apiAdminOrders_(restaurant); break;
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
    // Optional logo shown in the app header. Any URL the browser can load.
    logoUrl: String(config.LogoUrl || '').trim(),
    centralKitchenEmail: config.CentralKitchenEmail || '',
    // Where invoices go - the accountant. Falls back to the kitchen address.
    invoiceEmail: String(config.InvoiceEmail || '').trim() || String(config.CentralKitchenEmail || ''),
    // Shown on the invoice as the supplier. Falls back to the app title.
    kitchenName: String(config.KitchenName || '').trim() || String(config.AppTitle || 'Central Kitchen'),
    // Order cut-off: OrderCutoffHour o'clock, OrderCutoffDaysBefore days ahead
    // of the delivery date. Default: 4pm the day before.
    orderCutoffHour: numberOr_(config.OrderCutoffHour, 16),
    orderCutoffDaysBefore: numberOr_(config.OrderCutoffDaysBefore, 1)
  };
}

/**
 * Prices are typed by hand in the sheet, so tolerate "$8.50", "8,50" and
 * stray spaces instead of silently showing $0.00.
 */
function parseAmount_(value) {
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  var cleaned = String(value == null ? '' : value).replace(/[^0-9.\-]/g, '');
  var n = Number(cleaned);
  return isNaN(n) ? 0 : n;
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
        address: r.DeliveryAddress || '',
        // Who the order is signed by. Falls back to the email so an order can
        // still go out if the admin has not filled the column in yet.
        ordererName: String(r.OrdererName || '').trim() || email,
        // Blank means an ordering restaurant; "kitchen" means central kitchen
        // staff, who fulfil orders and issue invoices instead of ordering.
        role: String(r.Role || '').trim().toLowerCase()
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
      price: parseAmount_(r.Price)
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

// ---------------------------------------------------------------------------
// Central kitchen: fulfil orders and issue invoices
//
// The kitchen cannot always supply everything a restaurant ordered. Rather than
// silently shipping short, the manager records what actually went out and
// issues an invoice for that. The invoice bills the supplied quantities and
// lists the shortfall line by line, so the accountant settles on real figures.
// ---------------------------------------------------------------------------

function requireKitchen_(user) {
  if (user.role !== ROLE_KITCHEN) {
    throw new Error('This screen is for central kitchen staff only.');
  }
}

/** Header row plus a name -> column lookup, so column order can change safely. */
function ordersSheetContext_() {
  var sheet = getSheet_(SHEET_NAMES.ORDERS);
  var lastCol = Math.max(1, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  return { sheet: sheet, headers: headers };
}

function columnNumber_(headers, name) {
  var i = headers.indexOf(name);
  if (i === -1) {
    throw new Error('The Orders tab has no "' + name + '" column. Add it to the header row - see SETUP.md.');
  }
  return i + 1;
}

function parseItemsJson_(value) {
  try {
    var parsed = JSON.parse(value || '[]');
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (err) {
    return [];
  }
}

function orderRowToObject_(r) {
  return {
    orderId: r.OrderID,
    timestamp: r.Timestamp ? Utilities.formatDate(new Date(r.Timestamp), getTimeZone_(), 'dd/MM/yyyy HH:mm') : '',
    restaurantName: r.RestaurantName,
    restaurantEmail: r.RestaurantEmail,
    ordererName: r.OrdererName,
    deliveryDate: r.DeliveryDate,
    deliveryAddress: r.DeliveryAddress,
    items: parseItemsJson_(r.ItemsJSON),
    supplied: parseItemsJson_(r.SuppliedJSON),
    total: r.Total,
    status: r.Status,
    notes: String(r.Notes || ''),
    kitchenNote: String(r.KitchenNote || ''),
    invoiceRef: String(r.InvoiceRef || ''),
    invoiceTotal: r.InvoiceTotal
  };
}

/** Orders waiting to be fulfilled, plus recently invoiced ones for reference. */
function apiKitchenOrders_(user) {
  requireKitchen_(user);
  var rows = sheetRowsAsObjects_(getSheet_(SHEET_NAMES.ORDERS));
  var recent = rows.slice(-KITCHEN_QUEUE_SCAN_ROWS).map(orderRowToObject_);
  recent.sort(function (a, b) { return (b.orderId || '').localeCompare(a.orderId || ''); });

  return {
    pending: recent.filter(function (o) { return String(o.status) !== STATUS_INVOICED; }),
    invoiced: recent.filter(function (o) { return String(o.status) === STATUS_INVOICED; }).slice(0, 20)
  };
}

/**
 * Records what the kitchen actually supplied and bills for it.
 * payload: { orderId, supplied: [{id, qty}], kitchenNote }
 */
function apiIssueInvoice_(user, payload) {
  requireKitchen_(user);

  var orderId = String((payload && payload.orderId) || '').trim();
  if (!orderId) throw new Error('No order was selected.');

  var ctx = ordersSheetContext_();
  var rows = sheetRowsAsObjects_(ctx.sheet);
  var match = rows.filter(function (r) { return String(r.OrderID) === orderId; })[0];
  if (!match) throw new Error('Order ' + orderId + ' was not found.');
  if (String(match.Status) === STATUS_INVOICED) {
    throw new Error('Order ' + orderId + ' has already been invoiced as ' + (match.InvoiceRef || 'an invoice') + '.');
  }

  var ordered = parseItemsJson_(match.ItemsJSON);
  if (!ordered.length) throw new Error('Order ' + orderId + ' has no items to invoice.');

  var suppliedById = {};
  ((payload && payload.supplied) || []).forEach(function (s) {
    suppliedById[String(s.id)] = Math.max(0, Number(s.qty) || 0);
  });

  var lines = [];
  var invoiceTotal = 0;
  var shortfallCount = 0;
  ordered.forEach(function (li) {
    // Unlisted item means nothing was supplied, not "supply everything".
    var suppliedQty = suppliedById.hasOwnProperty(String(li.id)) ? suppliedById[String(li.id)] : 0;
    if (suppliedQty > li.qty) suppliedQty = li.qty; // cannot bill more than ordered
    var lineTotal = (Number(li.price) || 0) * suppliedQty;
    invoiceTotal += lineTotal;
    if (suppliedQty < li.qty) shortfallCount++;
    lines.push({
      id: li.id,
      name: li.name,
      unit: li.unit,
      price: li.price,
      orderedQty: li.qty,
      qty: suppliedQty,
      shortQty: li.qty - suppliedQty,
      lineTotal: lineTotal
    });
  });

  var invoiceRef = 'INV' + Utilities.formatDate(new Date(), getTimeZone_(), 'yyMMdd-HHmmss');
  var kitchenNote = String((payload && payload.kitchenNote) || '').trim().slice(0, MAX_NOTES_LENGTH);
  var order = orderRowToObject_(match);

  // Email first: a failure here must not leave the sheet claiming the invoice
  // was issued when nobody has received it.
  sendInvoiceEmail_({
    invoiceRef: invoiceRef,
    issuedBy: user.ordererName || user.email,
    order: order,
    lines: lines,
    invoiceTotal: invoiceTotal,
    shortfallCount: shortfallCount,
    kitchenNote: kitchenNote
  });

  var row = match._row;
  ctx.sheet.getRange(row, columnNumber_(ctx.headers, 'SuppliedJSON')).setValue(JSON.stringify(lines));
  ctx.sheet.getRange(row, columnNumber_(ctx.headers, 'InvoiceRef')).setValue(invoiceRef);
  ctx.sheet.getRange(row, columnNumber_(ctx.headers, 'InvoiceTotal')).setValue(invoiceTotal);
  ctx.sheet.getRange(row, columnNumber_(ctx.headers, 'InvoicedAt')).setValue(new Date());
  ctx.sheet.getRange(row, columnNumber_(ctx.headers, 'KitchenNote')).setValue(kitchenNote);
  ctx.sheet.getRange(row, columnNumber_(ctx.headers, 'Status')).setValue(STATUS_INVOICED);

  return { ok: true, invoiceRef: invoiceRef, invoiceTotal: invoiceTotal, shortfallCount: shortfallCount };
}

// ---------------------------------------------------------------------------
// Admin: read-only view across every restaurant and every invoice
// ---------------------------------------------------------------------------

function requireAdmin_(user) {
  if (user.role !== ROLE_ADMIN) {
    throw new Error('This screen is for administrators only.');
  }
}

function apiAdminOrders_(user) {
  requireAdmin_(user);

  var rows = sheetRowsAsObjects_(getSheet_(SHEET_NAMES.ORDERS));
  var orders = rows.slice(-ADMIN_SCAN_ROWS).map(orderRowToObject_);
  orders.sort(function (a, b) { return (b.orderId || '').localeCompare(a.orderId || ''); });

  var names = {};
  var pending = 0;
  var invoicedTotal = 0;
  orders.forEach(function (o) {
    if (o.restaurantName) names[o.restaurantName] = true;
    if (String(o.status) === STATUS_INVOICED) invoicedTotal += Number(o.invoiceTotal) || 0;
    else pending++;
  });

  return {
    orders: orders,
    restaurants: Object.keys(names).sort(),
    summary: {
      orderCount: orders.length,
      pendingCount: pending,
      invoicedCount: orders.length - pending,
      invoicedTotal: invoicedTotal
    }
  };
}

function apiOrderPageData_(restaurant) {
  return {
    appTitle: getConfig_().appTitle,
    logoUrl: getConfig_().logoUrl,
    restaurant: restaurant,
    role: restaurant.role,
    // Kitchen and admin accounts do not order, so skip the catalogue work.
    items: restaurant.role ? [] : getActiveItems_(),
    deliveryDates: restaurant.role ? [] : getUpcomingDeliveryDates_()
  };
}

// ---------------------------------------------------------------------------
// Order submission
// ---------------------------------------------------------------------------

function apiSubmitOrder_(restaurant, order) {
  if (!order || !order.items || !order.items.length) {
    throw new Error('Your cart is empty.');
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
  var ordererName = restaurant.ordererName;
  var notes = String(order.notes || '').trim().slice(0, MAX_NOTES_LENGTH);

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
    total: total,
    notes: notes
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
    STATUS_SENT,
    notes
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
  if (data.notes) {
    textLines.push('');
    textLines.push('*** NOTES FROM THE RESTAURANT ***');
    textLines.push(data.notes);
  }
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
    (data.notes
      ? '<div style="margin-top:18px;padding:12px 14px;border-left:4px solid #c0392b;background:#fdf3f2;max-width:480px;">' +
        '<div style="font-weight:bold;margin-bottom:4px;">Notes from the restaurant</div>' +
        '<div style="white-space:pre-wrap;">' + escapeHtml_(data.notes) + '</div>' +
        '</div>'
      : '') +
    '<p style="margin-top:16px;color:#555;">Order ref: ' + escapeHtml_(data.orderId) + '</p>' +
    '<p>--<br>' + escapeHtml_(data.ordererName) + '<br>' + escapeHtml_(data.restaurant.name) + '</p>' +
    '</div>';

  GmailApp.sendEmail(config.centralKitchenEmail, subject, body, {
    htmlBody: htmlBody,
    cc: data.restaurant.email,
    name: data.restaurant.name + ' - CKOA'
  });
}

function invoiceHtml_(data) {
  var config = getConfig_();
  var o = data.order;

  var rowsHtml = data.lines.map(function (li) {
    var short = li.shortQty > 0;
    return '<tr>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;">' + escapeHtml_(li.name) + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;color:#777;">' + li.orderedQty + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;' +
        (short ? 'color:#c0392b;font-weight:bold;' : '') + '">' + li.qty + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;' +
        (short ? 'color:#c0392b;' : 'color:#bbb;') + '">' + (short ? '-' + li.shortQty : '0') + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;">' + escapeHtml_(li.unit) + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' + formatCurrency_(li.price) + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' + formatCurrency_(li.lineTotal) + '</td>' +
      '</tr>';
  }).join('');

  var shortNotice = data.shortfallCount
    ? '<div style="margin:16px 0;padding:12px 14px;border-left:4px solid #c0392b;background:#fdf3f2;">' +
      '<strong>' + data.shortfallCount + ' item(s) could not be supplied in full.</strong><br>' +
      'This invoice bills the supplied quantities only. The Short column shows what was not delivered.' +
      '</div>'
    : '';

  var noteHtml = data.kitchenNote
    ? '<div style="margin:16px 0;padding:12px 14px;border-left:4px solid #8a5a00;background:#fbf2df;">' +
      '<strong>Note from the kitchen</strong><br>' +
      '<span style="white-space:pre-wrap;">' + escapeHtml_(data.kitchenNote) + '</span></div>'
    : '';

  var orderNoteHtml = o.notes
    ? '<p style="color:#555;font-size:13px;"><strong>Restaurant\'s note on the order:</strong><br>' +
      '<span style="white-space:pre-wrap;">' + escapeHtml_(o.notes) + '</span></p>'
    : '';

  return '<div style="font-family:Arial,sans-serif;font-size:13px;color:#222;max-width:720px;">' +
    '<h2 style="margin:0 0 4px;">Invoice ' + escapeHtml_(data.invoiceRef) + '</h2>' +
    '<p style="margin:0 0 18px;color:#666;">Issued ' + Utilities.formatDate(new Date(), getTimeZone_(), 'dd/MM/yyyy HH:mm') + '</p>' +
    '<table style="width:100%;margin-bottom:18px;"><tr>' +
    '<td style="vertical-align:top;width:50%;"><strong>From</strong><br>' + escapeHtml_(config.kitchenName) + '</td>' +
    '<td style="vertical-align:top;"><strong>To</strong><br>' + escapeHtml_(o.restaurantName) + '<br>' +
    escapeHtml_(o.deliveryAddress) + '</td>' +
    '</tr></table>' +
    '<p style="margin:0 0 14px;color:#555;">' +
    'Order ref: ' + escapeHtml_(o.orderId) + '<br>' +
    'Ordered by: ' + escapeHtml_(o.ordererName) + ' on ' + escapeHtml_(o.timestamp) + '<br>' +
    'Delivery date: ' + escapeHtml_(o.deliveryDate) + '<br>' +
    'Invoiced by: ' + escapeHtml_(data.issuedBy) +
    '</p>' +
    shortNotice +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<thead><tr style="background:#f4f1ee;">' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #333;">Item</th>' +
    '<th style="text-align:center;padding:6px 8px;border-bottom:2px solid #333;">Ordered</th>' +
    '<th style="text-align:center;padding:6px 8px;border-bottom:2px solid #333;">Supplied</th>' +
    '<th style="text-align:center;padding:6px 8px;border-bottom:2px solid #333;">Short</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #333;">Unit</th>' +
    '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333;">Price</th>' +
    '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333;">Amount</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
    '<tfoot><tr><td colspan="6" style="padding:10px 8px;text-align:right;border-top:2px solid #333;">' +
    '<strong>Total invoiced</strong></td>' +
    '<td style="padding:10px 8px;text-align:right;border-top:2px solid #333;font-size:15px;">' +
    '<strong>' + formatCurrency_(data.invoiceTotal) + '</strong></td></tr></tfoot>' +
    '</table>' +
    noteHtml +
    orderNoteHtml +
    '</div>';
}

function sendInvoiceEmail_(data) {
  var config = getConfig_();
  if (!config.invoiceEmail) {
    throw new Error('No invoice recipient is set. Fill in InvoiceEmail (or CentralKitchenEmail) in the Settings tab.');
  }

  var o = data.order;
  var subject = 'Invoice ' + data.invoiceRef + ' - ' + o.restaurantName + ' - delivery ' + o.deliveryDate +
    (data.shortfallCount ? ' (short supply)' : '');

  var textLines = [];
  textLines.push('Invoice ' + data.invoiceRef);
  textLines.push('Restaurant: ' + o.restaurantName);
  textLines.push('Order ref: ' + o.orderId);
  textLines.push('Delivery date: ' + o.deliveryDate);
  textLines.push('');
  if (data.shortfallCount) {
    textLines.push(data.shortfallCount + ' item(s) could not be supplied in full. Billed on supplied quantities.');
    textLines.push('');
  }
  data.lines.forEach(function (li) {
    textLines.push('- ' + li.name + ': ordered ' + li.orderedQty + ', supplied ' + li.qty + ' ' + li.unit +
      (li.shortQty > 0 ? ' (short ' + li.shortQty + ')' : '') + ' = ' + formatCurrency_(li.lineTotal));
  });
  textLines.push('');
  textLines.push('Total invoiced: ' + formatCurrency_(data.invoiceTotal));
  if (data.kitchenNote) {
    textLines.push('');
    textLines.push('Note from the kitchen: ' + data.kitchenNote);
  }

  var html = invoiceHtml_(data);
  var pdf = Utilities.newBlob(html, 'text/html', data.invoiceRef + '.html')
    .getAs('application/pdf')
    .setName(data.invoiceRef + '.pdf');

  GmailApp.sendEmail(config.invoiceEmail, subject, textLines.join('\n'), {
    htmlBody: html,
    cc: o.restaurantEmail,
    name: config.kitchenName,
    attachments: [pdf]
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
      status: r.Status,
      notes: String(r.Notes || '')
    };
  });
}
