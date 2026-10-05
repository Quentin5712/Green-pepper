'use strict';
const mongoose = require('mongoose');
const { ProductVariant, StockMovement, Cart } = require('../models/Product');

/**
 * StockService — Green Pepper Market
 * Toutes les mutations de stock passent ici. Jamais d'update direct sur stockPhysique.
 */
class StockService {

  // ═══════════════════════════════════════════════════════════
  // RÉSERVATION PANIER — anti-survente atomique
  // findOneAndUpdate avec $expr : atomique, pas de race condition
  // ═══════════════════════════════════════════════════════════
  async reserveStock(variantId, quantity, cartId, session = null) {
    if (quantity <= 0) throw new Error('Quantité invalide');

    const opts = session ? { session } : {};

    // Atomic : on ne réserve que si stockDisponible >= quantity
    const variant = await ProductVariant.findOneAndUpdate(
      {
        _id: variantId,
        isActive: true,
        $expr: {
          $gte: [{ $subtract: ['$stockPhysique', '$stockReserve'] }, quantity]
        }
      },
      { $inc: { stockReserve: quantity } },
      { new: true, ...opts }
    );

    if (!variant) {
      const v = await ProductVariant.findById(variantId);
      if (!v) throw new Error(`Variant ${variantId} introuvable`);
      throw new Error(`Stock insuffisant pour SKU ${v.sku} (disponible: ${v.stockPhysique - v.stockReserve})`);
    }

    // Enregistrer le mouvement
    await StockMovement.create([{
      variantId: variant._id,
      sku:       variant.sku,
      vendorId:  variant.vendorId,
      type:      'RESERVE',
      quantity,
      reason:    'Réservation panier',
      cartId:    String(cartId),
      previous:  variant.stockPhysique,
      after:     variant.stockPhysique, // physique inchangé, seule la réserve bouge
    }], opts.session ? { session: opts.session } : {});

    return {
      variantId: variant._id,
      sku: variant.sku,
      stockDisponible: variant.stockPhysique - variant.stockReserve,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CONFIRMATION COMMANDE — RESERVE → OUT
  // Transaction MongoDB : atomique sur plusieurs documents
  // ═══════════════════════════════════════════════════════════
  async confirmStock(orderId, items) {
    // items = [{ variantId, quantity }]
    const session = await mongoose.startSession();
    session.startTransaction();
    const movements = [];

    try {
      for (const { variantId, quantity } of items) {
        // Décrémenter physique ET réserve en une seule op
        const variant = await ProductVariant.findOneAndUpdate(
          {
            _id: variantId,
            stockPhysique: { $gte: quantity },
            stockReserve:  { $gte: quantity },
          },
          {
            $inc: {
              stockPhysique: -quantity,
              stockReserve:  -quantity,
            }
          },
          { new: true, session }
        );

        if (!variant) {
          throw new Error(`Impossible de confirmer le stock pour variant ${variantId}`);
        }

        movements.push({
          variantId: variant._id,
          sku:       variant.sku,
          vendorId:  variant.vendorId,
          type:      'OUT',
          quantity,
          reason:    'Commande confirmée',
          orderId:   String(orderId),
          previous:  variant.stockPhysique + quantity, // avant la décrémentation
          after:     variant.stockPhysique,
        });

        // Vérifier alerte stock faible
        if (variant.stockPhysique <= variant.lowLimit) {
          movements.push({
            variantId: variant._id,
            sku:       variant.sku,
            vendorId:  variant.vendorId,
            type:      'ADJUSTMENT',
            quantity:  0,
            reason:    `⚠️ Stock faible — seuil ${variant.lowLimit} atteint`,
            orderId:   String(orderId),
            previous:  variant.stockPhysique,
            after:     variant.stockPhysique,
          });
        }
      }

      await StockMovement.insertMany(movements, { session });
      await session.commitTransaction();
      return { success: true, orderId, itemsConfirmed: items.length };

    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LIBÉRER LES RÉSERVATIONS DE PANIERS EXPIRÉS
  // Appelé par cron toutes les 5 minutes
  // ═══════════════════════════════════════════════════════════
  async releaseExpiredCarts() {
    const now = new Date();
    const expiredCarts = await Cart.find({
      status: { $in: ['active', 'reserved'] },
      expiresAt: { $lt: now },
    }).select('_id sessionId items');

    if (!expiredCarts.length) return { released: 0 };

    let released = 0;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      for (const cart of expiredCarts) {
        const reservedItems = cart.items.filter(i => i.reserved && i.quantity > 0);

        for (const item of reservedItems) {
          const variant = await ProductVariant.findOneAndUpdate(
            { _id: item.variantId, stockReserve: { $gte: item.quantity } },
            { $inc: { stockReserve: -item.quantity } },
            { new: true, session }
          );

          if (variant) {
            await StockMovement.create([{
              variantId: variant._id,
              sku:       variant.sku,
              vendorId:  variant.vendorId,
              type:      'RELEASE',
              quantity:  item.quantity,
              reason:    'Expiration panier',
              cartId:    String(cart._id),
              previous:  variant.stockPhysique,
              after:     variant.stockPhysique,
            }], { session });
            released++;
          }
        }

        await Cart.updateOne(
          { _id: cart._id },
          { status: 'expired' },
          { session }
        );
      }

      await session.commitTransaction();
      console.log(`🔄 releaseExpiredCarts: ${released} réservations libérées, ${expiredCarts.length} paniers expirés`);
      return { released, cartsExpired: expiredCarts.length };

    } catch (err) {
      await session.abortTransaction();
      console.error('releaseExpiredCarts error:', err.message);
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AJOUT DE STOCK (entrée marchand)
  // ═══════════════════════════════════════════════════════════
  async addStock(variantId, quantity, reason = 'Réapprovisionnement', operatorId = null) {
    if (quantity <= 0) throw new Error('La quantité doit être positive');

    const variant = await ProductVariant.findByIdAndUpdate(
      variantId,
      { $inc: { stockPhysique: quantity } },
      { new: true }
    );

    if (!variant) throw new Error(`Variant ${variantId} introuvable`);

    await StockMovement.create({
      variantId: variant._id,
      sku:       variant.sku,
      vendorId:  variant.vendorId,
      type:      'IN',
      quantity,
      reason,
      operatorId,
      previous:  variant.stockPhysique - quantity,
      after:     variant.stockPhysique,
    });

    return {
      sku:             variant.sku,
      stockPhysique:   variant.stockPhysique,
      stockReserve:    variant.stockReserve,
      stockDisponible: variant.stockPhysique - variant.stockReserve,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AJUSTEMENT DE STOCK (correction inventaire)
  // ═══════════════════════════════════════════════════════════
  async adjustStock(variantId, newPhysique, reason, operatorId = null) {
    const variant = await ProductVariant.findById(variantId);
    if (!variant) throw new Error(`Variant ${variantId} introuvable`);

    const diff = newPhysique - variant.stockPhysique;
    const updated = await ProductVariant.findByIdAndUpdate(
      variantId,
      { $set: { stockPhysique: newPhysique } },
      { new: true }
    );

    await StockMovement.create({
      variantId: updated._id,
      sku:       updated.sku,
      vendorId:  updated.vendorId,
      type:      'ADJUSTMENT',
      quantity:  Math.abs(diff),
      reason:    reason || `Ajustement: ${variant.stockPhysique} → ${newPhysique}`,
      operatorId,
      previous:  variant.stockPhysique,
      after:     newPhysique,
    });

    return {
      sku:             updated.sku,
      previous:        variant.stockPhysique,
      after:           newPhysique,
      diff,
      stockDisponible: newPhysique - updated.stockReserve,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // GET STOCK DISPONIBLE
  // ═══════════════════════════════════════════════════════════
  async getAvailableStock(variantId) {
    const v = await ProductVariant.findById(variantId).select('sku stockPhysique stockReserve lowLimit isActive');
    if (!v) throw new Error(`Variant ${variantId} introuvable`);
    return {
      variantId:       v._id,
      sku:             v.sku,
      stockPhysique:   v.stockPhysique,
      stockReserve:    v.stockReserve,
      stockDisponible: v.stockPhysique - v.stockReserve,
      isLow:           (v.stockPhysique - v.stockReserve) <= v.lowLimit,
      isActive:        v.isActive,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // STOCK PAR VENDEUR
  // ═══════════════════════════════════════════════════════════
  async getVendorStock(vendorId, options = {}) {
    const { page = 1, limit = 50, lowStockOnly = false } = options;
    const query = { vendorId, isActive: true };

    const variants = await ProductVariant.find(query)
      .populate('productId', 'title categoryId images')
      .select('sku attributes price stockPhysique stockReserve lowLimit productId')
      .sort({ stockPhysique: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean({ virtuals: true });

    const result = variants.map(v => ({
      ...v,
      stockDisponible: v.stockPhysique - v.stockReserve,
      isLow: (v.stockPhysique - v.stockReserve) <= v.lowLimit,
    }));

    return lowStockOnly ? result.filter(v => v.isLow) : result;
  }

  // Historique des mouvements d'un variant
  async getMovements(variantId, limit = 50) {
    return StockMovement.find({ variantId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}

module.exports = new StockService();
