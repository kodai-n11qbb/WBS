/**
 * =========================================================================
 * WBSer - Googleスプレッドシート一方通行連携スクリプト (Google Apps Script)
 * =========================================================================
 * 
 * 【使い方】
 * 1. Googleスプレッドシートを新規作成（または既存のシートを開く）
 * 2. メニュー「拡張機能」>「Apps Script」を開き、本コードをすべて貼り付けて保存
 * 3. 画面右上の「デプロイ」>「新しいデプロイ」をクリック
 *    - 種類の選択: 「ウェブアプリ」
 *    - 次のユーザーとして実行: 「自分」
 *    - アクセスできるユーザー: 「全員」
 * 4. 発行された「ウェブアプリのURL」をコピーし、WBSerの画面または設定に貼り付ける
 * 
 * ※ WBSer側で2次元配列と色情報を一括整形して送信するため、
 *    本スクリプトは setValues 1発でシート全体を即時更新し、負荷は実質ゼロです。
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'No payload received' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();

    // 接続テスト (PING)
    if (payload.action === 'PING') {
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK', message: 'WBSer Connected successfully' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ガントマトリクス一括更新
    if (payload.action === 'SYNC_MATRIX' && payload.matrix && payload.matrix.length > 0) {
      var numRows = payload.matrix.length;
      var numCols = payload.matrix[0].length;

      // 既存の内容・書式をクリア
      sheet.clear();

      // 1. セル値の一括流し込み (1APIコール)
      var range = sheet.getRange(1, 1, numRows, numCols);
      range.setValues(payload.matrix);

      // 2. セル背景色の一括適用 (1APIコール)
      if (payload.backgrounds && payload.backgrounds.length === numRows) {
        range.setBackgrounds(payload.backgrounds);
      }

      // 3. テキスト色の一括適用 (1APIコール)
      if (payload.fontColors && payload.fontColors.length === numRows) {
        range.setFontColors(payload.fontColors);
      }

      // 4. 見栄え調整: 1行目(ヘッダー)と2列目(WBS階層)の枠固定
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(2);

      // 列幅の自動調整 (主要列)
      sheet.setColumnWidth(1, 45);  // No
      sheet.setColumnWidth(2, 280); // WBSタスク階層
      sheet.setColumnWidth(3, 85);  // ステータス
      sheet.setColumnWidth(4, 95);  // 完了予定日

      return ContentService.createTextOutput(JSON.stringify({
        status: 'OK',
        updatedRows: numRows,
        updatedCols: numCols,
        timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'Invalid action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
