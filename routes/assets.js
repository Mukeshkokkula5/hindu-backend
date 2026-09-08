const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const LOGO_PATH = path.join(__dirname, "../assets/logo.png");

function normalizeRole(role) {
  if (!role) return "";
  const r = role.toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (r === "SECRETARY") return "GENERAL_SECRETARY";
  if (r === "EC" || r === "EXECUTIVE") return "EC_MEMBER";
  return r;
}

function allowAssetManagement(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const allowed = [
    "SUPER_ADMIN",
    "ADMIN",
    "PRESIDENT",
    "VICE_PRESIDENT",
    "GENERAL_SECRETARY",
    "JOINT_SECRETARY",
    "TREASURER",
    "EC_MEMBER",
  ];
  const role = normalizeRole(req.user.role);
  if (!allowed.includes(role)) {
    res.status(403).json({ error: "Access denied: insufficient permissions to manage assets" });
    return false;
  }
  return true;
}

function formatINR(num) {
  return Number(num || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ======================================================
   📦 1. GET ALL ASSETS & LIVE KPI METRICS
====================================================== */
router.get("/", verifyToken, async (req, res) => {
  try {
    const { rows: assets } = await pool.query(`
      SELECT * FROM association_assets
      ORDER BY id ASC
    `);

    const { rows: rentalRows } = await pool.query(`
      SELECT * FROM asset_rentals
      WHERE status = 'ACTIVE'
      ORDER BY expected_return_date ASC
    `);

    // Check for overdue rentals
    const todayStr = new Date().toISOString().slice(0, 10);
    const overdueCount = rentalRows.filter(r => r.expected_return_date && new Date(r.expected_return_date).toISOString().slice(0, 10) < todayStr).length;

    const totalAssets = assets.length;
    const availableAssets = assets.filter(a => a.status === "AVAILABLE").length;
    const rentedAssets = assets.filter(a => a.status === "RENTED_OUT").length;
    const totalValuation = assets.reduce((sum, a) => sum + Number(a.purchase_cost || 0), 0);
    const totalRentRevenue = assets.reduce((sum, a) => sum + Number(a.total_revenue_earned || 0), 0);

    res.json({
      success: true,
      kpis: {
        total_assets: totalAssets,
        available_assets: availableAssets,
        rented_assets: rentedAssets,
        overdue_rentals: overdueCount,
        total_valuation: totalValuation,
        total_rent_revenue: totalRentRevenue,
      },
      assets,
      active_rentals: rentalRows,
    });
  } catch (err) {
    console.error("GET ASSETS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch assets: " + err.message });
  }
});

/* ======================================================
   ➕ 2. CREATE NEW ASSET (SUPER ADMIN / PRESIDENT / TREASURER)
====================================================== */
router.post("/", verifyToken, async (req, res) => {
  if (!allowAssetManagement(req, res)) return;
  try {
    const {
      name,
      category = "OTHER",
      quantity = 1,
      market_rent_per_day = 0,
      hsy_rent_per_day = 0,
      security_deposit = 0,
      purchase_cost = 0,
      condition = "GOOD",
      location_stored = "HSY Office Store Room, Jagtial",
      notes = "",
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Asset name is required" });
    }

    // Generate next tag: HSY-AST-XXXX (collision-resistant)
    const maxRes = await pool.query(`
      SELECT COALESCE(MAX(
        CASE 
          WHEN asset_tag ~ '^HSY-AST-[0-9]+$' THEN CAST(SUBSTRING(asset_tag FROM 9) AS INTEGER)
          ELSE id
        END
      ), 0) + 1 AS next_num
      FROM association_assets
    `);
    const nextNum = parseInt(maxRes.rows[0].next_num, 10) || 1;
    const assetTag = `HSY-AST-${String(nextNum).padStart(4, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO association_assets 
       (asset_tag, name, category, quantity, market_rent_per_day, hsy_rent_per_day, security_deposit, purchase_cost, condition, status, location_stored, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AVAILABLE', $10, $11)
       RETURNING *`,
      [
        assetTag,
        name.trim(),
        category,
        parseInt(quantity, 10) || 1,
        parseFloat(market_rent_per_day) || 0,
        parseFloat(hsy_rent_per_day) || 0,
        parseFloat(security_deposit) || 0,
        parseFloat(purchase_cost) || 0,
        condition,
        location_stored.trim(),
        notes.trim(),
      ]
    );

    res.status(201).json({ success: true, message: "Asset added successfully", asset: rows[0] });
  } catch (err) {
    console.error("CREATE ASSET ERROR:", err);
    res.status(500).json({ error: "Failed to create asset: " + err.message });
  }
});

/* ======================================================
   ✏️ 3. UPDATE ASSET DETAILS & RENTAL PRICING
====================================================== */
router.put("/:id", verifyToken, async (req, res) => {
  if (!allowAssetManagement(req, res)) return;
  try {
    const { id } = req.params;
    const {
      name,
      category,
      quantity,
      market_rent_per_day,
      hsy_rent_per_day,
      security_deposit,
      purchase_cost,
      condition,
      location_stored,
      notes,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE association_assets
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           quantity = COALESCE($3, quantity),
           market_rent_per_day = COALESCE($4, market_rent_per_day),
           hsy_rent_per_day = COALESCE($5, hsy_rent_per_day),
           security_deposit = COALESCE($6, security_deposit),
           purchase_cost = COALESCE($7, purchase_cost),
           condition = COALESCE($8, condition),
           location_stored = COALESCE($9, location_stored),
           notes = COALESCE($10, notes),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        name,
        category,
        quantity ? parseInt(quantity, 10) : undefined,
        market_rent_per_day ? parseFloat(market_rent_per_day) : undefined,
        hsy_rent_per_day ? parseFloat(hsy_rent_per_day) : undefined,
        security_deposit ? parseFloat(security_deposit) : undefined,
        purchase_cost ? parseFloat(purchase_cost) : undefined,
        condition,
        location_stored,
        notes,
        id,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Asset not found" });
    }

    res.json({ success: true, message: "Asset updated successfully", asset: rows[0] });
  } catch (err) {
    console.error("UPDATE ASSET ERROR:", err);
    res.status(500).json({ error: "Failed to update asset: " + err.message });
  }
});

/* ======================================================
   🗑️ 4. DELETE ASSET
====================================================== */
router.delete("/:id", verifyToken, async (req, res) => {
  if (!allowAssetManagement(req, res)) return;
  try {
    const { id } = req.params;
    const assetCheck = await pool.query("SELECT status FROM association_assets WHERE id = $1", [id]);
    if (!assetCheck.rows.length) {
      return res.status(404).json({ error: "Asset not found" });
    }
    if (assetCheck.rows[0].status === "RENTED_OUT") {
      return res.status(400).json({ error: "Cannot delete an asset that is currently rented out. Please mark it as returned first." });
    }

    await pool.query("DELETE FROM association_assets WHERE id = $1", [id]);
    res.json({ success: true, message: "Asset deleted successfully" });
  } catch (err) {
    console.error("DELETE ASSET ERROR:", err);
    res.status(500).json({ error: "Failed to delete asset: " + err.message });
  }
});

/* ======================================================
   📤 5. ISSUE ASSET ON RENT (HALF-PRICE COMMUNITY BOOKING)
====================================================== */
router.post("/:id/rent", verifyToken, async (req, res) => {
  if (!allowAssetManagement(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { id } = req.params;
    const {
      renter_type = "MEMBER", // 'MEMBER' | 'CITIZEN'
      user_id = null,
      renter_name,
      renter_phone,
      renter_address = "",
      purpose = "Community & Festival Usage",
      rent_start_date,
      expected_return_date,
      daily_rent,
      paid_amount = 0,
      payment_mode = "CASH",
      deposit_collected = 0,
      remarks = "",
    } = req.body;

    if (!renter_name || !renter_name.trim()) {
      return res.status(400).json({ error: "Renter name is required" });
    }
    if (!renter_phone || !renter_phone.trim()) {
      return res.status(400).json({ error: "Renter phone number is required" });
    }
    if (!rent_start_date || !expected_return_date) {
      return res.status(400).json({ error: "Start date and return date are required" });
    }

    const { rows: assetRows } = await client.query(
      "SELECT * FROM association_assets WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (!assetRows.length) {
      return res.status(404).json({ error: "Asset not found" });
    }
    const asset = assetRows[0];
    if (asset.status === "RENTED_OUT") {
      return res.status(400).json({ error: `This item is already rented out to ${asset.current_renter_name} until ${asset.expected_return_date}` });
    }

    // Calculate days & rent
    const d1 = new Date(rent_start_date);
    const d2 = new Date(expected_return_date);
    const diffTime = Math.max(d2.getTime() - d1.getTime(), 0);
    const totalDays = Math.max(Math.ceil(diffTime / (1000 * 60 * 60 * 24)), 1);
    const rentRate = daily_rent ? parseFloat(daily_rent) : parseFloat(asset.hsy_rent_per_day);
    const totalRentAmount = rentRate * totalDays;
    const paid = parseFloat(paid_amount) || 0;
    const paymentStatus = paid >= totalRentAmount ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";

    // Generate rental code (collision-resistant)
    const year = new Date().getFullYear();
    const maxRentalRes = await client.query(
      `SELECT COALESCE(MAX(
        CASE 
          WHEN rental_code ~ ('^HSY-RNT-' || $1 || '-[0-9]+$') THEN CAST(SUBSTRING(rental_code FROM 14) AS INTEGER)
          ELSE id
        END
      ), 0) + 1 AS next_num
      FROM asset_rentals`,
      [year]
    );
    const rentalNum = parseInt(maxRentalRes.rows[0].next_num, 10) || 1;
    const rentalCode = `HSY-RNT-${year}-${String(rentalNum).padStart(4, "0")}`;

    const issuedByName = req.user?.name || req.user?.username || "Office Admin";

    // Insert rental record
    const { rows: rentalInsert } = await client.query(
      `INSERT INTO asset_rentals
       (rental_code, asset_id, asset_name, renter_type, user_id, renter_name, renter_phone, renter_address, purpose,
        rent_start_date, expected_return_date, total_days, daily_rent, total_rent_amount, paid_amount,
        payment_status, payment_mode, deposit_collected, status, issued_by_name, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'ACTIVE', $19, $20)
       RETURNING *`,
      [
        rentalCode,
        asset.id,
        asset.name,
        renter_type,
        user_id || null,
        renter_name.trim(),
        renter_phone.trim(),
        renter_address.trim(),
        purpose.trim(),
        rent_start_date,
        expected_return_date,
        totalDays,
        rentRate,
        totalRentAmount,
        paid,
        paymentStatus,
        payment_mode,
        parseFloat(deposit_collected) || 0,
        issuedByName,
        remarks.trim(),
      ]
    );

    // Update asset status to RENTED_OUT
    await client.query(
      `UPDATE association_assets
       SET status = 'RENTED_OUT',
           current_renter_name = $1,
           current_renter_phone = $2,
           expected_return_date = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [renter_name.trim(), renter_phone.trim(), expected_return_date, asset.id]
    );

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: `Item rented successfully to ${renter_name}`,
      rental: rentalInsert[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("RENT ASSET ERROR:", err);
    res.status(500).json({ error: "Failed to rent asset: " + err.message });
  } finally {
    client.release();
  }
});

/* ======================================================
   📥 6. RETURN RENTED ASSET & REVENUE ACCUMULATION
====================================================== */
router.post("/rentals/:rentalId/return", verifyToken, async (req, res) => {
  if (!allowAssetManagement(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rentalId } = req.params;
    const {
      return_condition = "GOOD",
      final_paid_amount = 0,
      deposit_refunded = 0,
      damage_charge = 0,
      remarks = "",
    } = req.body;

    const { rows: rentalRows } = await client.query(
      "SELECT * FROM asset_rentals WHERE id = $1 FOR UPDATE",
      [rentalId]
    );

    if (!rentalRows.length) {
      return res.status(404).json({ error: "Rental record not found" });
    }
    const rental = rentalRows[0];
    if (rental.status === "RETURNED") {
      return res.status(400).json({ error: "This item has already been marked as returned." });
    }

    const receivedByName = req.user?.name || req.user?.username || "Office Admin";
    const actualReturnDate = new Date().toISOString().slice(0, 10);
    const totalCollected = parseFloat(rental.paid_amount || 0) + (parseFloat(final_paid_amount) || 0) + (parseFloat(damage_charge) || 0);

    // Update rental record
    await client.query(
      `UPDATE asset_rentals
       SET status = 'RETURNED',
           actual_return_date = $1,
           paid_amount = $2,
           payment_status = 'PAID',
           deposit_refunded = $3,
           received_by_name = $4,
           remarks = COALESCE(remarks, '') || CASE WHEN $5 != '' THEN ' | Return Notes: ' || $5 ELSE '' END
       WHERE id = $6`,
      [actualReturnDate, totalCollected, parseFloat(deposit_refunded) || 0, receivedByName, remarks.trim(), rental.id]
    );

    // Update asset: set status back to AVAILABLE and add totalCollected to total_revenue_earned
    await client.query(
      `UPDATE association_assets
       SET status = 'AVAILABLE',
           condition = $1,
           current_renter_name = NULL,
           current_renter_phone = NULL,
           expected_return_date = NULL,
           total_revenue_earned = total_revenue_earned + $2,
           updated_at = NOW()
       WHERE id = $3`,
      [return_condition, totalCollected, rental.asset_id]
    );

    await client.query("COMMIT");
    res.json({
      success: true,
      message: `Asset "${rental.asset_name}" returned successfully. Revenue recorded: Rs. ${totalCollected}`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("RETURN ASSET ERROR:", err);
    res.status(500).json({ error: "Failed to process asset return: " + err.message });
  } finally {
    client.release();
  }
});

/* ======================================================
   📋 7. GET ALL RENTALS AUDIT TRAIL
====================================================== */
router.get("/rentals", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, a.asset_tag, a.category
      FROM asset_rentals r
      JOIN association_assets a ON a.id = r.asset_id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("GET RENTALS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch rental history" });
  }
});

/* ======================================================
   📄 8. DOWNLOAD ASSET REGISTER & RENTAL REVENUE PDF
====================================================== */
router.get("/pdf", async (req, res) => {
  try {
    const [assetsRes, rentalsRes, metaRes] = await Promise.all([
      pool.query("SELECT * FROM association_assets ORDER BY id ASC"),
      pool.query("SELECT * FROM asset_rentals ORDER BY created_at DESC LIMIT 20"),
      pool.query("SELECT * FROM association_settings ORDER BY id DESC LIMIT 1"),
    ]);

    const assets = assetsRes.rows;
    const rentals = rentalsRes.rows;
    const meta = metaRes.rows[0] || {
      association_name: "HINDU SWARAJ YOUTH WELFARE ASSOCIATION",
      reg_number: "784/2025",
      address: "H.No. 4-1-140, Vani Nagar, Jagtial, Telangana - 505327",
      phone: "+91 84998 78425",
      email: "hinduswarajyouth@gmail.com",
      president_name: "Vinodh Kumar Kokkula",
      treasurer_name: "Sambari Sai",
    };

    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="HSY_Asset_Rental_Register.pdf"`);
    doc.pipe(res);

    // Header
    const hasLogo = fs.existsSync(LOGO_PATH);
    if (hasLogo) {
      try {
        const logoWidth = 48;
        doc.image(LOGO_PATH, (doc.page.width - logoWidth) / 2, 20, { width: logoWidth, height: logoWidth });
        doc.y = 74;
      } catch (_) {
        doc.y = 30;
      }
    } else {
      doc.y = 30;
    }

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#580505").text("HINDU SWARAJ YOUTH WELFARE ASSOCIATION", { align: "center" });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#991b1b").text(`(Regd No: ${meta.reg_number || "784/2025"} • Govt. of Telangana)`, { align: "center" });
    doc.font("Helvetica").fontSize(7.5).fillColor("#475569").text(`${meta.address || "Vani Nagar, Jagtial"} • Helpline: ${meta.phone || "+91 84998 78425"}`, { align: "center" });
    doc.moveDown(0.6);

    doc.strokeColor("#580505").lineWidth(1.2).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("COMMUNITY ASSET REGISTER & RENTAL REVENUE REPORT", { align: "center" });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#166534").text("Equipment Custody, Half-Price Community Rentals & Sustainable Revenue Ledger", { align: "center" });
    
    const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`Generated On: ${istTime}`, { align: "center" });
    doc.moveDown(0.8);

    // KPI Summary
    let curY = doc.y;
    const boxW = (doc.page.width - 80 - 30) / 4;
    const totalValuation = assets.reduce((s, a) => s + Number(a.purchase_cost || 0), 0);
    const totalRevenue = assets.reduce((s, a) => s + Number(a.total_revenue_earned || 0), 0);
    const rentedCount = assets.filter(a => a.status === "RENTED_OUT").length;

    // Box 1
    doc.rect(40, curY, boxW, 40).fillAndStroke("#f8fafc", "#cbd5e1");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#64748b").text("TOTAL ASSETS", 46, curY + 6);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text(`${assets.length}`, 46, curY + 16);

    // Box 2
    doc.rect(40 + boxW + 10, curY, boxW, 40).fillAndStroke("#f0fdf4", "#86efac");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#166534").text("AVAILABLE NOW", 46 + boxW + 10, curY + 6);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#15803d").text(`${assets.filter(a => a.status === "AVAILABLE").length}`, 46 + boxW + 10, curY + 16);

    // Box 3
    doc.rect(40 + (boxW + 10) * 2, curY, boxW, 40).fillAndStroke("#fff7ed", "#fed7aa");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#c2410c").text("CURRENTLY RENTED", 46 + (boxW + 10) * 2, curY + 6);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ea580c").text(`${rentedCount}`, 46 + (boxW + 10) * 2, curY + 16);

    // Box 4
    doc.rect(40 + (boxW + 10) * 3, curY, boxW, 40).fillAndStroke("#eff6ff", "#93c5fd");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#1d4ed8").text("RENTAL REVENUE", 46 + (boxW + 10) * 3, curY + 6);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1e40af").text(`Rs. ${formatINR(totalRevenue)}`, 46 + (boxW + 10) * 3, curY + 18);

    curY += 50;

    // Table 1: Assets Inventory
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1e293b").text("1. COMMUNITY ASSETS INVENTORY & RENTAL PRICING", 40, curY);
    curY += 15;

    doc.rect(40, curY, doc.page.width - 80, 18).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#334155")
      .text("Tag", 45, curY + 5)
      .text("Item Name", 100, curY + 5)
      .text("Category", 235, curY + 5)
      .text("Mkt Rent", 305, curY + 5)
      .text("HSY Rent", 355, curY + 5)
      .text("Status / Custody", 410, curY + 5)
      .text("Earned", 495, curY + 5, { width: 55, align: "right" });

    curY += 19;
    doc.font("Helvetica").fontSize(6.8).fillColor("#1e293b");

    assets.forEach((a, idx) => {
      if (curY > doc.page.height - 120) {
        doc.addPage();
        curY = 40;
        doc.rect(40, curY, doc.page.width - 80, 18).fill("#f1f5f9");
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#334155")
          .text("Tag", 45, curY + 5)
          .text("Item Name", 100, curY + 5)
          .text("Category", 235, curY + 5)
          .text("Mkt Rent", 305, curY + 5)
          .text("HSY Rent", 355, curY + 5)
          .text("Status / Custody", 410, curY + 5)
          .text("Earned", 495, curY + 5, { width: 55, align: "right" });
        curY += 19;
        doc.font("Helvetica").fontSize(6.8);
      }
      if (idx % 2 === 1) doc.rect(40, curY - 2, doc.page.width - 80, 15).fill("#fafafa");

      const statusText = a.status === "RENTED_OUT" ? `Rented: ${a.current_renter_name || "Citizen"}` : a.status;
      doc.fillColor("#0f172a")
        .text(a.asset_tag, 45, curY)
        .text(a.name, 100, curY, { width: 130, lineBreak: false })
        .text(a.category, 235, curY, { width: 65, lineBreak: false })
        .text(`Rs. ${a.market_rent_per_day}`, 305, curY)
        .text(`Rs. ${a.hsy_rent_per_day}`, 355, curY)
        .text(statusText, 410, curY, { width: 85, lineBreak: false })
        .text(`Rs. ${formatINR(a.total_revenue_earned)}`, 495, curY, { width: 55, align: "right" });
      curY += 15;
    });

    curY += 14;

    // Table 2: Active / Recent Rentals
    if (rentals.length > 0) {
      if (curY > doc.page.height - 160) {
        doc.addPage();
        curY = 40;
      }
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1e293b").text("2. RECENT ASSET RENTAL & CUSTODY LOGS", 40, curY);
      curY += 15;

      doc.rect(40, curY, doc.page.width - 80, 18).fill("#f1f5f9");
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#334155")
        .text("Rental Code", 45, curY + 5)
        .text("Item Name", 120, curY + 5)
        .text("Renter Name", 230, curY + 5)
        .text("Phone", 315, curY + 5)
        .text("Return Due", 375, curY + 5)
        .text("Paid (Rs.)", 440, curY + 5)
        .text("Status", 500, curY + 5);

      curY += 19;
      doc.font("Helvetica").fontSize(6.8).fillColor("#1e293b");

      rentals.forEach((r, idx) => {
        if (curY > doc.page.height - 120) {
          doc.addPage();
          curY = 40;
          doc.rect(40, curY, doc.page.width - 80, 18).fill("#f1f5f9");
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#334155")
            .text("Rental Code", 45, curY + 5)
            .text("Item Name", 120, curY + 5)
            .text("Renter Name", 230, curY + 5)
            .text("Phone", 315, curY + 5)
            .text("Return Due", 375, curY + 5)
            .text("Paid (Rs.)", 440, curY + 5)
            .text("Status", 500, curY + 5);
          curY += 19;
          doc.font("Helvetica").fontSize(6.8);
        }
        if (idx % 2 === 1) doc.rect(40, curY - 2, doc.page.width - 80, 15).fill("#fafafa");
        const dueStr = r.expected_return_date ? new Date(r.expected_return_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "N/A";
        doc.fillColor("#0f172a")
          .text(r.rental_code, 45, curY)
          .text(r.asset_name, 120, curY, { width: 105, lineBreak: false })
          .text(r.renter_name, 230, curY, { width: 80, lineBreak: false })
          .text(r.renter_phone, 315, curY)
          .text(dueStr, 375, curY)
          .text(`Rs. ${formatINR(r.paid_amount)}`, 440, curY)
          .text(r.status, 500, curY);
        curY += 15;
      });
    }

    // Signatures
    const bottomY = doc.page.height - 90;
    doc.strokeColor("#cbd5e1").lineWidth(0.8).moveTo(40, bottomY).lineTo(doc.page.width - 40, bottomY).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text("PRESIDENT", 60, bottomY + 20);
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(meta.president_name || "Vinodh Kumar Kokkula", 60, bottomY + 32);

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#580505").text("[ ASSOCIATION SEAL ]", doc.page.width / 2 - 50, bottomY + 20, { width: 100, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`Regd. No: ${meta.reg_number || "784/2025"}`, doc.page.width / 2 - 50, bottomY + 32, { width: 100, align: "center" });

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text("TREASURER", doc.page.width - 150, bottomY + 20, { align: "right", width: 90 });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(meta.treasurer_name || "Sambari Sai", doc.page.width - 150, bottomY + 32, { align: "right", width: 90 });

    doc.end();
  } catch (err) {
    console.error("GENERATE ASSET PDF ERROR:", err);
    res.status(500).json({ error: "Failed to generate asset PDF: " + err.message });
  }
});

module.exports = router;
