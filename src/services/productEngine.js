/**
 * Product & Medication Recommendation Engine
 *
 * Maps detected problems to specific products, dosages, and steps.
 */

const PRODUCTS = {
  ammonia: {
    category: "Water Treatment",
    product: "Zeolite / Ammonia Binder",
    dosagePerAcre: 50, // kg
    unit: "kg",
    steps: [
      "Apply directly to the water in areas with highest accumulation.",
      "Ensure aerators are running during application.",
      "Repeat after 3-5 days if levels remain high."
    ]
  },
  high_organic_load: {
    category: "Water Treatment",
    product: "Water Probiotics (Bacillus strains)",
    dosagePerAcre: 1, // kg
    unit: "kg",
    steps: [
      "Brew with molasses for 12-24 hours for better results.",
      "Apply during the morning (9-10 AM).",
      "Reduce feed by 20% for 2 days."
    ]
  },
  slow_growth: {
    category: "Feed Supplement",
    product: "Gut Probiotic / Vitamin C",
    dosagePerKgFeed: 5, // grams
    unit: "g",
    steps: [
      "Mix thoroughly with feed using a binder (gel/oil).",
      "Let the feed dry in shade for 30 mins before broadcasting.",
      "Use for 5-7 consecutive days."
    ]
  },
  disease_bacterial: {
    category: "Medication",
    product: "Bactericide / Sanitizer (BKC or Iodine)",
    dosagePerAcre: 1, // liter
    unit: "L",
    steps: [
      "Dilute in a bucket of water before application.",
      "Apply during early morning or evening.",
      "Wait 48 hours before applying probiotics."
    ]
  },
  wssv_emergency: {
    category: "Emergency",
    product: "Immediate Harvest / Expert Consultation",
    dosagePerAcre: 0,
    unit: "N/A",
    steps: [
      "Do NOT exchange water or discharge to nearby ponds.",
      "Stop feeding immediately.",
      "Consult your local fisheries officer for emergency harvest guidelines."
    ]
  },
  fish_bacterial: {
    category: "Medication",
    product: "Antibiotic (Florfenicol / Amoxicillin)",
    dosagePerKgFeed: 10, // mg
    unit: "mg",
    steps: [
      "Mix with feed using a good quality binder.",
      "Feed for 10-14 consecutive days even if mortality stops.",
      "Increase aeration and stop water exchange during treatment.",
      "Consult a vet for exact prescription."
    ]
  },
  eus_emergency: {
    category: "Medication",
    product: "Potassium Permanganate (KMnO4) or Formalin",
    dosagePerAcre: 2, // kg
    unit: "kg",
    steps: [
      "Dissolve KMnO4 in a bucket and broadcast across the pond.",
      "Apply during early morning.",
      "Maintain high aeration during treatment.",
      "Repeat after 5 days if ulcers don't heal."
    ]
  },
  fish_parasites: {
    category: "Medication",
    product: "Parasiticide (Deltamethrin / BKC)",
    dosagePerAcre: 500, // ml
    unit: "ml",
    steps: [
      "Dilute thoroughly and apply evenly.",
      "Apply during the morning hours.",
      "Do not feed for 6 hours after application.",
      "Check fish skin after 48 hours for parasite removal."
    ]
  },
  white_feces: {
    category: "Medication",
    product: "Gut Probiotic (Growel Gut Pro) + Water Probiotic",
    dosagePerKgFeed: 10, // grams
    unit: "g",
    steps: [
      "Reduce feeding by 30-50% immediately.",
      "Mix Gut Probiotic with feed using a binder.",
      "Apply Water Probiotics (2kg/acre) during morning.",
      "Check fecal strings daily; if they turn dark, resume feed slowly."
    ]
  },
  ems_emergency: {
    category: "Emergency",
    product: "Vibrio Control (Florfenicol) + Probiotics",
    dosagePerKgFeed: 15, // mg
    unit: "mg",
    steps: [
      "STOP FEEDING completely for 24 hours.",
      "Run ALL aerators at maximum capacity.",
      "Apply high-dose probiotics (Bacillus) to compete with Vibrio.",
      "Consult a vet for antibiotic prescription if mortality is high."
    ]
  }
};

/**
 * Get product recommendation based on problem and pond context
 */
function getRecommendation(problem, context = {}) {
  const rec = PRODUCTS[problem];
  if (!rec) return null;

  const pondSize = context.pondSizeValue || 1; // Default to 1 acre if unknown
  
  let calculatedDosage = "";
  if (rec.dosagePerAcre > 0) {
    calculatedDosage = `${rec.dosagePerAcre * pondSize} ${rec.unit}`;
  } else if (rec.dosagePerKgFeed > 0) {
    calculatedDosage = `${rec.dosagePerKgFeed} ${rec.unit} per kg of feed`;
  } else {
    calculatedDosage = rec.product === "Immediate Harvest / Expert Consultation" ? "N/A" : "As per label";
  }

  return {
    category: rec.category,
    product: rec.product,
    dosage: calculatedDosage,
    steps: rec.steps
  };
}

/**
 * Format recommendation for WhatsApp
 */
function formatRecommendation(rec) {
  if (!rec) return "";

  let msg = `💊 *Recommended Product & Dosage*\n\n`;
  msg += `📦 *Product:* ${rec.product}\n`;
  msg += `⚖️ *Dosage:* ${rec.dosage}\n`;
  msg += `🛠️ *Steps:*\n`;
  rec.steps.forEach(step => {
    msg += `👉 ${step}\n`;
  });
  
  return msg;
}

/**
 * Map pond size string to numeric value
 */
function getPondSizeValue(sizeStr) {
  if (sizeStr === 'less_than_1_acre') return 0.5;
  if (sizeStr === '1_3_acres') return 2;
  if (sizeStr === 'more_than_3_acres') return 4;
  return 1;
}

module.exports = {
  getRecommendation,
  formatRecommendation,
  getPondSizeValue
};
