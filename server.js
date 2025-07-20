require('dotenv').config();
const express = require('express');
const app = express();
const pool = require('./db');

const PORT = process.env.PORT || 5000;
const TTL = parseInt(process.env.TTL_SECONDS);
app.use(express.json());

// ⏱️ Helper to get future expiry time
const getExpiryTime = () => {
  const now = new Date();
  return new Date(now.getTime() + TTL * 1000);
};

// 📌 Request Lock
app.post('/locks/request', async (req, res) => {
  const { resource_name, process_id } = req.body;
  const now = new Date();
  const expires_at = getExpiryTime();

  try {
    const result = await pool.query(
      'SELECT * FROM locks WHERE resource_name = $1',
      [resource_name]
    );

    const existing = result.rows[0];

    if (!existing || new Date(existing.expires_at) < now) {
      if (existing) {
        await pool.query(
          'UPDATE locks SET process_id = $1, acquired_at = $2, expires_at = $3 WHERE resource_name = $4',
          [process_id, now, expires_at, resource_name]
        );
      } else {
        await pool.query(
          'INSERT INTO locks (resource_name, process_id, acquired_at, expires_at) VALUES ($1, $2, $3, $4)',
          [resource_name, process_id, now, expires_at]
        );
      }
      return res.json({ status: 'acquired', resource_name, process_id });
    }

    if (existing.process_id === process_id) {
      return res.json({ status: 'acquired', resource_name, process_id });
    }

    return res.json({ status: 'denied', resource_name, process_id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// 🔓 Release Lock
app.post('/locks/release', async (req, res) => {
  const { resource_name, process_id } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM locks WHERE resource_name = $1',
      [resource_name]
    );

    const lock = result.rows[0];

    if (!lock || lock.process_id !== process_id) {
      return res.json({ status: 'not_locked_by_process', resource_name });
    }

    await pool.query('DELETE FROM locks WHERE resource_name = $1', [resource_name]);
    return res.json({ status: 'released', resource_name });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// 🔍 Lock Status
app.get('/locks/status/:resource_name', async (req, res) => {
  const { resource_name } = req.params;
  const now = new Date();

  try {
    const result = await pool.query(
      'SELECT * FROM locks WHERE resource_name = $1',
      [resource_name]
    );

    const lock = result.rows[0];

    if (!lock || new Date(lock.expires_at) < now) {
      return res.json({ resource_name, is_locked: false });
    }

    return res.json({
      resource_name,
      is_locked: true,
      process_id: lock.process_id,
      acquired_at: lock.acquired_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// 📋 All Active Locks
app.get('/locks/all-locked', async (req, res) => {
  const now = new Date();
  try {
    const result = await pool.query(
      'SELECT * FROM locks WHERE expires_at > $1',
      [now]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// 🔎 Locks by Process ID
app.get('/locks/process/:process_id', async (req, res) => {
  const { process_id } = req.params;
  const now = new Date();
  try {
    const result = await pool.query(
      'SELECT * FROM locks WHERE process_id = $1 AND expires_at > $2',
      [process_id, now]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
