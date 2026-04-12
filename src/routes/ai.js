const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const supabase = require('../lib/supabase');
const auth     = require('../middleware/auth');
const { askRulebook, summarizeNotice } = require('../lib/gemini');

const router  = express.Router();

// Multer: store uploaded PDF temporarily in backend/uploads/
const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' ||
        file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF or TXT files allowed'));
    }
  }
});

// ─────────────────────────────────────────────
// POST /api/ai/rulebook — admin uploads rulebook
// ─────────────────────────────────────────────
router.post('/rulebook', auth, upload.single('rulebook'), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Read file content
    let text = '';

    if (req.file.mimetype === 'text/plain') {
      // Plain text — read directly
      text = fs.readFileSync(req.file.path, 'utf-8');
    } else {
      // PDF — extract text using basic approach
      // For MVP we store the raw buffer and use Gemini's file API
      // Simple alternative: ask admin to upload as .txt for now
      text = fs.readFileSync(req.file.path, 'utf-8');
    }

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    // Save rulebook text to Supabase Storage
    const fileName = `${req.user.society_id}/rulebook.txt`;
    const { error: uploadErr } = await supabase.storage
      .from('rulebooks')
      .upload(fileName, Buffer.from(text), {
        contentType: 'text/plain',
        upsert: true  // overwrite if exists
      });

    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    // Save public URL to society record
    const { data: urlData } = supabase.storage
      .from('rulebooks')
      .getPublicUrl(fileName);

    await supabase
      .from('societies')
      .update({ rulebook_url: urlData.publicUrl })
      .eq('id', req.user.society_id);

    res.json({
      success: true,
      message: 'Rulebook uploaded successfully',
      url: urlData.publicUrl,
      characters: text.length
    });

  } catch (err) {
    // Clean up temp file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/ai/rulebook — check if rulebook exists
// ─────────────────────────────────────────────
router.get('/rulebook', auth, async (req, res) => {
  const { data: society } = await supabase
    .from('societies')
    .select('rulebook_url, name')
    .eq('id', req.user.society_id)
    .single();

  res.json({
    has_rulebook: !!society?.rulebook_url,
    rulebook_url: society?.rulebook_url || null,
    society_name: society?.name
  });
});

// ─────────────────────────────────────────────
// POST /api/ai/chat — resident asks a question
// ─────────────────────────────────────────────
router.post('/chat', auth, async (req, res) => {
  const { question, language = 'en' } = req.body;

  if (!question?.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  // 1. Get society's rulebook URL
  const { data: society } = await supabase
    .from('societies')
    .select('rulebook_url, name')
    .eq('id', req.user.society_id)
    .single();

  if (!society?.rulebook_url) {
    return res.status(404).json({
      error: 'Rulebook not uploaded yet. Ask your admin to upload the society rulebook.'
    });
  }

  // 2. Fetch rulebook text from Supabase Storage
  const { data: fileData, error: fileErr } = await supabase.storage
    .from('rulebooks')
    .download(`${req.user.society_id}/rulebook.txt`);

  if (fileErr) return res.status(500).json({ error: 'Could not load rulebook' });

  const rulebook = await fileData.text();

  // 3. Ask Gemini
  let aiResponse;
  try {
    aiResponse = await askRulebook(rulebook, question.trim(), language);
  } catch (err) {
    return res.status(500).json({ error: 'AI service error: ' + err.message });
  }

  // 4. Save to ai_chat_logs
  await supabase.from('ai_chat_logs').insert({
    society_id: req.user.society_id,
    user_id:    req.user.id,
    question:   question.trim(),
    answer:     aiResponse.answer,
    rule_cited: aiResponse.rule_cited,
    language
  });

  res.json({
    answer:     aiResponse.answer,
    rule_cited: aiResponse.rule_cited,
    society:    society.name
  });
});

// ─────────────────────────────────────────────
// POST /api/ai/chat/:logId/feedback — thumbs up/down
// ─────────────────────────────────────────────
router.post('/chat/:logId/feedback', auth, async (req, res) => {
  const { helpful } = req.body; // true or false

  if (typeof helpful !== 'boolean') {
    return res.status(400).json({ error: 'helpful must be true or false' });
  }

  const { data, error } = await supabase
    .from('ai_chat_logs')
    .update({ helpful })
    .eq('id', req.params.logId)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

// ─────────────────────────────────────────────
// POST /api/ai/summarize-notice — auto-summary when admin posts notice
// ─────────────────────────────────────────────
router.post('/summarize-notice', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body is required' });

  try {
    const summary = await summarizeNotice(body);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;