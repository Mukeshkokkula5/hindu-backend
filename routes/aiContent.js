const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");

// Smart AI Fallback Knowledge Base & Templates for Seva & Dharmic Initiatives
function generateOfflineSevaMatter(prompt, contentType, language, tone) {
  const pLower = (prompt || "").toLowerCase();
  const isCorona = pLower.includes("corona") || pLower.includes("covid") || pLower.includes("అన్నదాన") || pLower.includes("food") || pLower.includes("50");
  const isMedical = pLower.includes("hospital") || pLower.includes("medical") || pLower.includes("ఆరోగ్య") || pLower.includes("ఆపద్బాంధవ") || pLower.includes("aid") || pLower.includes("పేషెంట్");
  const isBlood = pLower.includes("blood") || pLower.includes("రక్త") || pLower.includes("శిబిరం") || pLower.includes("camp");
  const isNavaratri = pLower.includes("navaratri") || pLower.includes("గణేష్") || pLower.includes("వినాయక") || pLower.includes("darshan") || pLower.includes("aarti");

  let telugu = "";
  let english = "";

  if (isCorona) {
    telugu = `కరోనా మహమ్మారి జగిత్యాల పట్టణాన్ని వణికించిన విపత్కర రోజుల్లో... లాక్‌డౌన్ ఆంక్షల వల్ల బస్టాండ్లు, రైల్వే స్టేషన్లు, రోడ్లపై తిండిలేక అలమటించిన నిరుపేదలు, వలస కార్మికులు, అనాథలు మరియు ఆసుపత్రి రోగులకు "మేమున్నామంటూ" హిందూ స్వరాజ్ యూత్ సభ్యులు అండగా నిలిచారు.

నిరంతరం 50 రోజుల పాటు ప్రతి రోజూ ఉదయం, సాయంత్రం వేడివేడి పౌష్టికాహార భోజన ప్యాకెట్లు తయారు చేసి జగిత్యాల నలుమూలలా స్వయంగా వెళ్లి పంపిణీ చేశారు. ఎండను, వైరస్ భయాన్ని లెక్కచేయకుండా సేవాధర్మమే పరమావధిగా నిలిచిన యువ సైన్యం ఇది.

ఈ మహా సంకల్పానికి సహకరించిన ప్రతి ఒక్క దాతకు, రక్తదాతలకు, కార్యకర్తలకు, జగిత్యాల పోలీస్ యంత్రాంగానికి మరియు మున్సిపల్ సిబ్బందికి మా హృదయపూర్వక ధన్యవాదాలు. మానవ సేవే మాధవ సేవగా ముందుకు సాగుతున్నాము.`;

    english = `During the unprecedented peak of the COVID-19 nationwide lockdowns, Jagtial faced profound distress. Stranded migrant laborers, daily wage earners, hospital patient attendants, and impoverished citizens were left without basic sustenance.

Hindu Swaraj Youth stepped fearlessly to the frontlines. With safety precautions and burning compassion, our volunteers organized a community kitchen that prepared and distributed hygienic, hot meals daily without missing a single day for 50 consecutive days.

Over 50,000 hot meals were delivered across streets, hospital gates, checkposts, and quarantine shelters. We extend our heartfelt gratitude to every donor, volunteer, municipal worker, and police officer who supported this noble 50-day frontline seva mahayagnam.`;
  } else if (isMedical) {
    telugu = `ఆపదలో ఉన్న పేదవాడికి ప్రాణదానం చేయడమే హిందూ స్వరాజ్ "ఆపద్బాంధవ" సేవా సంకల్పం. తీవ్ర అనారోగ్యం, అత్యవసర చికిత్స మరియు శస్త్రచికిత్సల కోసం ఆసుపత్రుల్లో చేరిన నిరుపేద కుటుంబాలకు సత్వర ఆర్థిక సాయం, మందులు మరియు రక్తదానం అందిస్తూ అండగా నిలుస్తున్నాము.

సమాజంలో ఏ ఒక్కరూ వైద్య ఖర్చులు భరించలేక ప్రాణాలు కోల్పోకూడదన్నదే మా లక్ష్యం. మా వాలంటీర్లు స్వయంగా ఆసుపత్రులను సందర్శించి, డాక్టర్లతో మాట్లాడి బాధితులకు 100% పారదర్శకంగా నేరుగా చికిత్స ఖర్చులను అందిస్తున్నారు. దాతలు ముందుకు వచ్చి ప్రాణాపాయంలో ఉన్నవారికి పునర్జన్మ ప్రసాదించాలని కోరుతున్నాము.`;

    english = `The 'Aapadbandhava' initiative by Hindu Swaraj Youth is dedicated to saving lives by providing direct, transparent emergency medical aid to underprivileged patients facing critical illnesses, surgeries, and trauma cases.

Our verified volunteer network conducts direct hospital verifications to ensure that every rupee donated goes straight to hospital pharmacies and medical procedures. In times of extreme health crises, we stand as a shield for needy families, ensuring financial hardship never costs a human life.`;
  } else if (isBlood) {
    telugu = `ప్రతి బొట్టు రక్తం ఒక అమూల్యమైన ప్రాణాన్ని నిలబెడుతుంది. హిందూ స్వరాజ్ యూత్ 24/7 అత్యవసర రక్తదాన హెల్ప్‌లైన్ ద్వారా జగిత్యాల మరియు పరిసర ప్రాంతాలలో రక్త కొరతతో బాధపడే తలసేమియా పిల్లలు, గర్భిణీ స్త్రీలు, ప్రమాద బాధితులకు తక్షణమే రక్తం అందిస్తున్నాము.

మా వద్ద వేలాది మంది నమోదిత యువ రక్తదాతల నెట్‌వర్క్ సిద్ధంగా ఉంది. ప్రతి ఒక్క యువకుడు రక్తదానం చేయడానికి ముందుకు రావాలని, ప్రాణదాతలుగా నిలవాలని పిలుపునిస్తున్నాము. "రక్తదానం - జీవదానం".`;

    english = `Every single drop of blood has the divine power to save a human life. Hindu Swaraj Youth operates a 24/7 Emergency Blood Helpline connecting patients in acute distress with verified blood donors across Jagtial district.

From supporting pediatric Thalassemia patients to road trauma emergencies and complex surgeries, our youth warriors are ready round-the-clock. We urge everyone in good health to enroll as voluntary donors and become proud lifeline champions.`;
  } else if (isNavaratri) {
    telugu = `శ్రీ వినాయక చవితి నవరాత్రుల పర్వదినం సందర్భంగా హిందూ స్వరాజ్ మండపంలో భక్తిశ్రద్ధలతో ఉత్సవాలు ఘనంగా జరుగుతున్నాయి. ప్రతి రోజూ ఉదయం మహాన్యాసపూర్వక ఏకాదశ రుద్రాభిషేకం, మధ్యాహ్నం 1:00 గంటకు వేలాది మంది భక్తులకు రుచికరమైన మహా అన్నప్రసాద వితరణ, మరియు సాయంత్రం దివ్య మంగళ హారతి కార్యక్రమాలు నిర్వహించబడుతున్నాయి.

భక్తులందరూ ప్రత్యక్షంగా లేదా ఆన్‌లైన్ లైవ్ దర్శనం ద్వారా పాల్గొని విఘ్నేశ్వరుని కృపాకటాక్షాలు పొందాలని కోరుతున్నాము. భక్తి, ధర్మం, యువజన చైతన్యాల కలబోతే హిందూ స్వరాజ్ గణేశోత్సవం!`;

    english = `On the auspicious occasion of Sri Vinayaka Navaratri Mahotsavam, Hindu Swaraj Youth invites devotees across the nation to participate in our sacred celebrations. Witness daily Vedic Abhishekam, Sahasranamarchana, Grand Maha Annadanam feeding thousands, and divine evening Maha Aarti.

Join us in person at the grand Jagtial Pandal or watch our uninterrupted 4K Ultra-HD Live Stream online to receive the divine blessings of Lord Vigneshwara.`;
  } else {
    telugu = `${prompt ? prompt + " గురించి: " : ""}ధర్మ రక్షణ, యువజన సాధికారత మరియు నిస్వార్థ ప్రజాసేవ లక్ష్యంగా హిందూ స్వరాజ్ యూత్ జగిత్యాల గడ్డపై నిరంతరం కృషి చేస్తోంది. 

సమాజంలో ఆపదలో ఉన్న ప్రతి ఒక్కరికీ అండగా నిలవడం, విద్య, వైద్యం, రక్తదానం మరియు అన్నదాన కార్యక్రమాలను ప్రజల వద్దకే చేర్చడమే మా కర్తవ్యం. ఛత్రపతి శివాజీ మహారాజ్ ఆదర్శాలతో నవ సమాజ నిర్మాణంలో ప్రతి ఒక్కరూ భాగస్వాములు కావాలని ఆకాంక్షిస్తున్నాము.`;

    english = `${prompt ? "Regarding " + prompt + ": " : ""}Dedicated to youth empowerment, social welfare, and cultural revival, Hindu Swaraj Youth Welfare Association stands as a beacon of selfless service in Jagtial.

From 24/7 emergency medical aid and blood donation desks to community food distribution and student empowerment drives, our volunteers strive tirelessly to uplift the society. Guided by the indomitable spirit of Chhatrapati Shivaji Maharaj, we march forward building an empowered, compassionate Bharat.`;
  }

  return { telugu, english };
}

/* =====================================================
   🚀 POST /ai/generate
   Generates or polishes content in Telugu & English
===================================================== */
router.post("/generate", verifyToken, async (req, res) => {
  try {
    const { prompt, contentType = "STORY", language = "BOTH", tone = "INSPIRING", currentText = "" } = req.body;

    if (!prompt && !currentText) {
      return res.status(400).json({ success: false, error: "Please provide a prompt or existing text to enhance." });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    let teluguResult = "";
    let englishResult = "";

    // 1. If GEMINI_API_KEY exists, query Gemini Flash API
    if (geminiKey) {
      try {
        const sysPrompt = `You are an expert Telugu and English bilingual writer for Hindu Swaraj Youth Welfare Association, an esteemed non-profit youth organization in Jagtial, Telangana, dedicated to Chhatrapati Shivaji Maharaj's ideals, social welfare, food donation (Annadanam), emergency medical aid, and cultural festivals.
Task: Write compelling, authentic, respectful, and emotional content based on the user's input.
ContentType: ${contentType}
Tone: ${tone}

Return your response strictly in the following JSON format without markdown code fences:
{
  "telugu": "Detailed, elegant, natural Telugu text here (Telugu script)",
  "english": "Detailed, inspiring English text here"
}`;

        const userMsg = `Input topic/draft: "${prompt || currentText}"\nContent Type: ${contentType}\nTone: ${tone}`;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${sysPrompt}\n\n${userMsg}` }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            },
          }),
        });

        if (response.ok) {
          const apiData = await response.json();
          const rawText = apiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          try {
            const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleanJson);
            teluguResult = parsed.telugu || "";
            englishResult = parsed.english || "";
          } catch (pe) {
            teluguResult = rawText;
          }
        }
      } catch (geminiErr) {
        console.warn("Gemini API call notice, falling back to smart engine:", geminiErr.message);
      }
    }

    // 2. If Gemini was not used or failed, use smart curated Dharmic & Seva generator
    if (!teluguResult && !englishResult) {
      const generated = generateOfflineSevaMatter(prompt || currentText, contentType, language, tone);
      teluguResult = generated.telugu;
      englishResult = generated.english;
    }

    res.json({
      success: true,
      data: {
        telugu: teluguResult,
        english: englishResult,
        combined: `${teluguResult}\n\n---\n\n${englishResult}`,
      },
    });
  } catch (err) {
    console.error("AI GENERATE ERROR:", err.message);
    res.status(500).json({ success: false, error: "Failed to generate AI content" });
  }
});

module.exports = router;
