'use strict';
const path   = require('path');
const fs     = require('fs');
const logger = require('./logger');

const INVOICE_DIR = path.join(__dirname, '../../invoices');
fs.mkdirSync(INVOICE_DIR, { recursive: true });

async function generateInvoice(order) {
  try {
    const PDFDocument = require('pdfkit');
    const filePath = path.join(INVOICE_DIR, `facture-${order.orderNumber}.pdf`);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).fillColor('#1a1a1a').text('🌶️ Green Pepper Market', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text('Marché Camerounais — Paiement Mobile Money', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(14).fillColor('#1a1a1a').text(`Facture N° ${order.orderNumber}`);
    doc.fontSize(10).fillColor('#444').text(`Date: ${new Date(order.createdAt).toLocaleDateString('fr-FR')}`);
    doc.text(`Statut: ${order.status}`);
    doc.text(`Référence KPay: ${order.kpayTxId || order.externalId}`);
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#1a1a1a').text('Produits commandés:');
    doc.moveDown(0.3);
    (order.items || []).forEach(item => {
      doc.fontSize(10).fillColor('#333').text(
        `• ${item.name} x${item.qty} — ${Number(item.priceAtPurchase).toLocaleString('fr-FR')} FCFA/u`,
        { indent: 10 }
      );
    });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e0e0e0');
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Sous-total: ${Number(order.amount).toLocaleString('fr-FR')} FCFA`);
    doc.text(`Commission (10%): ${Number(order.commission).toLocaleString('fr-FR')} FCFA`);
    doc.fontSize(13).fillColor('#f97316').text(`Total payé: ${Number(order.finalAmount).toLocaleString('fr-FR')} FCFA`, { bold: true });

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#aaa').text('Green Pepper Market — Douala, Cameroun', { align: 'center' });
    doc.text('Merci de votre confiance.', { align: 'center' });

    doc.end();
    await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
    logger.info(`Facture générée: ${filePath}`);
    return filePath;
  } catch(e) {
    logger.error('generateInvoice:', e.message);
    return null;
  }
}

module.exports = { generateInvoice };
