const fs = require('fs');
const path = require('path');

// Load the database
const dbPath = path.join(__dirname, '..', '..', 'INDIA_AP_BRANDS_PRODUCTS_DB.json');
let productsDb = null;

try {
  const dbData = fs.readFileSync(dbPath, 'utf8');
  productsDb = JSON.parse(dbData);
} catch (error) {
  console.error('⚠️ Could not load AP Brands & Products DB:', error.message);
}

/**
 * Get product recommendations based on farmer's query
 * @param {string} queryText - The question or issue reported by the farmer
 * @param {object} pondData - Optional context about the pond (e.g., species)
 * @returns {string} - Formatted recommendations context string for the LLM
 */
function getRecommendations(queryText, pondData = null) {
  if (!productsDb) return '';

  const queryLower = queryText.toLowerCase();
  
  // 1. Identify matched problem keywords
  const allKeywords = productsDb.recommendation_engine_schema?.problem_keywords || [];
  
  // Also check common aliases that farmers might use
  const keywordAliases = {
    "white_gut": ["white gut", "white stool", "white string"],
    "slow_growth": ["slow growth", "not growing", "small size"],
    "mass_mortality": ["mortality", "dying", "dead shrimp"],
    "low_DO": ["low do", "floating", "gasping"],
    "high_ammonia": ["ammonia", "bad smell", "gas"],
    "loose_shell": ["loose shell", "soft shell", "weak shell"],
    "red_body": ["red body", "red discoloration"],
    "white_spots": ["white spot", "white dots", "wssv"],
    "black_spots": ["black spot", "black dots"],
    "pond_color_bad": ["algae", "bloom", "dark water", "green water"],
    "low_FCR": ["fcr", "eating much", "feed waste"],
    "high_Vibrio": ["vibrio", "green colony", "yellow colony"],
    "gill_rot": ["black gill", "brown gill", "gill rot"],
    "muscle_necrosis": ["white muscle", "muscle necrosis"]
  };

  const matchedKeywords = new Set();
  
  // Match standard keywords
  allKeywords.forEach(kw => {
    if (queryLower.includes(kw.toLowerCase().replace('_', ' '))) {
      matchedKeywords.add(kw);
    }
  });

  // Match aliases
  for (const [kw, aliases] of Object.entries(keywordAliases)) {
    for (const alias of aliases) {
      if (queryLower.includes(alias)) {
        matchedKeywords.add(kw);
      }
    }
  }

  // If no keywords matched, try direct word matching
  if (matchedKeywords.size === 0) {
    const directWords = ['vibrio', 'ammonia', 'sludge', 'gut', 'digestion', 'fcr', 'molting', 'shell', 'ph', 'nitrite', 'disease'];
    directWords.forEach(w => {
      if (queryLower.includes(w)) matchedKeywords.add(w);
    });
  }

  if (matchedKeywords.size === 0) {
    return ''; // No clear problem identified for recommendation
  }

  const recommendations = [];
  const pondSpecies = pondData?.species?.toLowerCase() || '';

  // 2. Search through the database categories
  for (const [catKey, category] of Object.entries(productsDb.categories)) {
    if (!category.brands) continue;

    for (const [brandKey, brandInfo] of Object.entries(category.brands)) {
      if (!brandInfo.products) continue;

      for (const product of brandInfo.products) {
        // Check if product's use_case matches our keywords
        let isMatch = false;
        const useCases = Array.isArray(product.use_case) ? product.use_case.map(u => u.toLowerCase()) : [product.use_case?.toLowerCase() || ''];
        
        for (const kw of matchedKeywords) {
          const kwStr = kw.toLowerCase().replace('_', ' ');
          if (useCases.some(u => u.includes(kwStr))) {
            isMatch = true;
            break;
          }
        }

        // Species filtering (if pond species is known and product specifies species)
        if (isMatch && pondSpecies && product.species) {
          const prodSpecies = Array.isArray(product.species) ? product.species : [product.species];
          const supportsSpecies = prodSpecies.some(s => s.toLowerCase().includes(pondSpecies) || pondSpecies.includes(s.toLowerCase()));
          // If it's explicitly for another species and doesn't mention "all aquaculture", skip
          if (!supportsSpecies && !prodSpecies.includes("All aquaculture") && !prodSpecies.some(s=>s.includes("fish") && pondSpecies.includes("fish"))) {
            isMatch = false;
          }
        }

        if (isMatch) {
          recommendations.push({
            brand: brandInfo.company || brandKey,
            product: product.product_name,
            type: product.type,
            dosage: product.dosage || product.dosage_water || product.dosage_feed || product.dosage_soil || 'Follow expert advice',
            expected_result: product.expected_result || product.notes || '',
            caution: product.caution || ''
          });
        }
      }
    }
  }

  // 3. Format the top recommendations
  if (recommendations.length === 0) return '';

  // Sort and limit to top 3 to avoid overwhelming context
  const topRecs = recommendations.slice(0, 3);
  
  let contextStr = `\n\n## Local Market Recommendations for [${Array.from(matchedKeywords).join(', ')}]:\n`;
  contextStr += `Use these specific products in your advice as options for the farmer.\n`;
  
  topRecs.forEach((rec, idx) => {
    contextStr += `${idx + 1}. **${rec.product}** (${rec.brand})\n`;
    contextStr += `   - Type: ${rec.type}\n`;
    contextStr += `   - Dosage: ${rec.dosage}\n`;
    if (rec.expected_result) contextStr += `   - Benefit: ${rec.expected_result}\n`;
    if (rec.caution) contextStr += `   - ⚠️ CAUTION: ${rec.caution}\n`;
  });

  return contextStr;
}

module.exports = {
  getRecommendations
};
