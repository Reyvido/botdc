const sodium = require('libsodium-wrappers');

const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const playdl = require('play-dl');
const http = require('http');

// ─────────────────────────────────────────
// HTTP SERVER biar Railway ga sleep
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot nyala!');
}).listen(PORT, () => {
  console.log(`HTTP server jalan di port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let connection;
let player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play }
});
let queue = [];
let currentSong = null;
let isPlaying = false;
let mode247 = false;
let manualLeave = false;
let currentVC = null;

const PREFIX = 'k!';
const DEFAULT_URL = "https://www.youtube.com/watch?v=jfKfPfyJRdk";

// ─────────────────────────────────────────
// HELPER: resolve input
// ─────────────────────────────────────────
async function resolveInput(input) {
  const type = await playdl.validate(input);

  if (type === 'yt_video') {
    const info = await playdl.video_info(input);
    return [{
      title: info.video_details.title,
      url: info.video_details.url,
      thumbnail: info.video_details.thumbnails?.[0]?.url || null,
      duration: formatDuration(info.video_details.durationInSec),
    }];
  }

  if (type === 'yt_playlist') {
    const playlist = await playdl.playlist_info(input, { incomplete: true });
    const videos = await playlist.all_videos();
    return videos.map(v => ({
      title: v.title,
      url: v.url,
      thumbnail: v.thumbnails?.[0]?.url || null,
      duration: formatDuration(v.durationInSec),
    }));
  }

  if (type === 'sp_track') {
    const spData = await playdl.spotify(input);
    const query = `${spData.name} ${spData.artists.map(a => a.name).join(' ')}`;
    const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results.length) throw new Error('Lagu Spotify ga ketemu di YouTube');
    return [{
      title: results[0].title,
      url: results[0].url,
      thumbnail: results[0].thumbnails?.[0]?.url || null,
      duration: formatDuration(results[0].durationInSec),
    }];
  }

  if (type === 'sp_album' || type === 'sp_playlist') {
    const spData = await playdl.spotify(input);
    const tracks = spData.fetched_tracks?.get('1') || [];
    const resolved = [];
    for (const track of tracks.slice(0, 50)) {
      const query = `${track.name} ${track.artists.map(a => a.name).join(' ')}`;
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
      if (results.length) {
        resolved.push({
          title: results[0].title,
          url: results[0].url,
          thumbnail: results[0].thumbnails?.[0]?.url || null,
          duration: formatDuration(results[0].durationInSec),
        });
      }
    }
    return resolved;
  }

  // Nama lagu / search query
  const results = await playdl.search(input, { source: { youtube: 'video' }, limit: 1 });
  if (!results.length) throw new Error('Lagu ga ketemu bro');
  return [{
    title: results[0].title,
    url: results[0].url,
    thumbnail: results[0].thumbnails?.[0]?.url || null,
    duration: formatDuration(results[0].durationInSec),
  }];
}

function formatDuration(sec) {
  if (!sec) return '??:??';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────
// CONNECT — timeout lebih panjang + retry
// ─────────────────────────────────────────
async function connect(vc, retryCount = 0) {
  manualLeave = false;
  currentVC = vc;

  try {
    // Kalau ada koneksi lama, destroy dulu
    if (connection) {
      try { connection.destroy(); } catch {}
      connection = null;
      await new Promise(r => setTimeout(r, 1000)); // tunggu bentar
    }

    connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: vc.guild.id,
      adapterCreator: vc.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    // Timeout diperpanjang jadi 60 detik buat Railway
    await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    connection.subscribe(player);
    console.log(`Connected ke VC: ${vc.name}`);

    // ── Disconnect handler ──
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (manualLeave) return;
      console.log('Disconnected dari VC, coba reconnect...');
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        console.log('Reconnect berhasil');
      } catch {
        // Gagal reconnect otomatis, paksa rejoin
        try { connection.destroy(); } catch {}
        connection = null;
        setTimeout(async () => {
          if (!manualLeave && currentVC) {
            await connect(currentVC);
            if (mode247 && !isPlaying) {
              await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
            }
          }
        }, 3000);
      }
    });

    // ── Destroyed handler ──
    connection.on(VoiceConnectionStatus.Destroyed, async () => {
      if (manualLeave) return;
      console.log('Connection destroyed, coba rejoin...');
      connection = null;
      setTimeout(async () => {
        if (!manualLeave && currentVC) {
          await connect(currentVC);
          if (mode247 && !isPlaying) {
            await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
          }
        }
      }, 5000);
    });

  } catch (err) {
    console.error(`Gagal connect (percobaan ${retryCount + 1}):`, err.message);
    try { connection?.destroy(); } catch {}
    connection = null;

    // Retry sampai 3x dengan jeda makin panjang
    if (retryCount < 3 && !manualLeave) {
      const delay = (retryCount + 1) * 5000; // 5s, 10s, 15s
      console.log(`Retry connect dalam ${delay / 1000} detik...`);
      await new Promise(r => setTimeout(r, delay));
      return connect(vc, retryCount + 1);
    }

    throw new Error('Gagal connect ke voice channel setelah 3x percobaan');
  }
}

// ─────────────────────────────────────────
// PLAY
// ─────────────────────────────────────────
async function playMusic(songObj) {
  try {
    isPlaying = true;
    currentSong = songObj;

    await sodium.ready;

    const source = await playdl.stream(songObj.url, {
      quality: 2,
      discordPlayerCompatibility: true,
    });

    const resource = createAudioResource(source.stream, {
      inputType: source.type,
      inlineVolume: false,
    });

    player.play(resource);
    console.log(`Playing: ${songObj.title}`);
  } catch (err) {
    console.error('Error playMusic:', err.message);
    isPlaying = false;
    currentSong = null;
    if (queue.length > 0) {
      setTimeout(() => playMusic(queue.shift()), 1000);
    } else if (mode247) {
      setTimeout(() => playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' }), 3000);
    }
  }
}

// ─────────────────────────────────────────
// IDLE
// ─────────────────────────────────────────
player.on(AudioPlayerStatus.Idle, async () => {
  isPlaying = false;
  currentSong = null;
  console.log('Player idle, queue:', queue.length);
  if (queue.length > 0) {
    await playMusic(queue.shift());
  } else if (mode247) {
    await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
  }
});

player.on('error', (err) => {
  console.error('Player error:', err.message);
  isPlaying = false;
  currentSong = null;
  if (queue.length > 0) {
    setTimeout(() => playMusic(queue.shift()), 1000);
  } else if (mode247) {
    setTimeout(() => playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' }), 3000);
  }
});

// ─────────────────────────────────────────
// READY
// ─────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`Bot nyala: ${c.user.tag}`);
  c.user.setActivity('k!help | 🎵 Music', { type: 2 });
});

// ─────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const vc = message.member?.voice?.channel;

  // ── HELP ──
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎵 Bot Music Commands')
      .setDescription('Prefix: `k!`')
      .addFields(
        { name: '`k!play <judul / link YT / link Spotify>`', value: 'Putar lagu — bisa nama lagu, link YouTube, atau link Spotify' },
        { name: '`k!search <judul>`', value: 'Cari lagu dan lihat 5 hasil teratas' },
        { name: '`k!skip`', value: 'Skip lagu yang lagi main' },
        { name: '`k!queue` / `k!q`', value: 'Lihat antrian lagu' },
        { name: '`k!nowplaying` / `k!np`', value: 'Lihat lagu yang lagi main' },
        { name: '`k!247`', value: 'Toggle mode 24/7 — bot ga akan keluar VC sampai `k!leave`' },
        { name: '`k!join`', value: 'Bot masuk voice channel' },
        { name: '`k!leave`', value: '⚠️ Satu-satunya cara keluarin bot dari VC' },
      )
      .setFooter({ text: 'Support: Nama lagu • YouTube link • Spotify track/album/playlist' });
    return message.reply({ embeds: [embed] });
  }

  // ── JOIN ──
  if (command === 'join') {
    if (!vc) return message.reply('Masuk voice dulu bro');
    try {
      await connect(vc);
      return message.reply('Join voice ✅');
    } catch (err) {
      return message.reply(`❌ Gagal join: ${err.message}`);
    }
  }

  // ── PLAY ──
  if (command === 'play') {
    const input = args.join(' ');
    if (!input) return message.reply('Masukin judul lagu, link YouTube, atau link Spotify bro');
    if (!vc) return message.reply('Masuk voice dulu bro');

    const loading = await message.reply('🔍 Nyari lagu...');

    try {
      const songs = await resolveInput(input);
      if (!connection) await connect(vc);

      if (songs.length === 1) {
        const song = { ...songs[0], requestedBy: message.author.username };

        if (isPlaying) {
          queue.push(song);
          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('➕ Masuk Queue')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
              { name: 'Durasi', value: song.duration, inline: true },
              { name: 'Posisi', value: `#${queue.length}`, inline: true },
              { name: 'Request by', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail);
          return loading.edit({ content: '', embeds: [embed] });
        }

        await playMusic(song);
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('▶️ Now Playing')
          .setDescription(`**[${song.title}](${song.url})**`)
          .addFields(
            { name: 'Durasi', value: song.duration, inline: true },
            { name: 'Request by', value: song.requestedBy, inline: true }
          )
          .setThumbnail(song.thumbnail);
        return loading.edit({ content: '', embeds: [embed] });

      } else {
        const songsWithReq = songs.map(s => ({ ...s, requestedBy: message.author.username }));
        if (!isPlaying) {
          await playMusic(songsWithReq.shift());
          queue.push(...songsWithReq);
        } else {
          queue.push(...songsWithReq);
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📋 Playlist / Album Ditambahkan')
          .setDescription(`**${songs.length} lagu** berhasil masuk queue`)
          .addFields({ name: 'Request by', value: message.author.username });
        return loading.edit({ content: '', embeds: [embed] });
      }

    } catch (err) {
      console.error(err);
      return loading.edit(`❌ Error: ${err.message}`);
    }
  }

  // ── SEARCH ──
  if (command === 'search') {
    const query = args.join(' ');
    if (!query) return message.reply('Masukin judul lagu bro');

    const loading = await message.reply('🔍 Nyari lagu...');

    try {
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 5 });
      if (!results.length) return loading.edit('❌ Lagu ga ketemu bro');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🔍 Hasil pencarian: "${query}"`)
        .setDescription(
          results.map((v, i) =>
            `**${i + 1}.** [${v.title}](${v.url}) — \`${formatDuration(v.durationInSec)}\``
          ).join('\n')
        )
        .setFooter({ text: 'Gunakan k!play <judul atau link> buat putar lagunya' });

      return loading.edit({ content: '', embeds: [embed] });
    } catch (err) {
      return loading.edit(`❌ Error: ${err.message}`);
    }
  }

  // ── SKIP ──
  if (command === 'skip') {
    if (!isPlaying) return message.reply('Ga ada lagu yang lagi main bro');
    player.stop();
    return message.reply('⏭️ Skip!');
  }

  // ── QUEUE ──
  if (command === 'queue' || command === 'q') {
    if (!currentSong && queue.length === 0) return message.reply('Queue kosong bro');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Queue');

    if (currentSong) {
      embed.addFields({
        name: '▶️ Now Playing',
        value: `[${currentSong.title}](${currentSong.url}) — \`${currentSong.duration}\``
      });
    }

    if (queue.length > 0) {
      const list = queue.slice(0, 10).map((s, i) =>
        `**${i + 1}.** [${s.title}](${s.url}) — \`${s.duration}\``
      ).join('\n');
      embed.addFields({ name: `📋 Next Up (${queue.length} lagu)`, value: list });
      if (queue.length > 10) embed.setFooter({ text: `+ ${queue.length - 10} lagu lagi...` });
    }

    return message.reply({ embeds: [embed] });
  }

  // ── NOW PLAYING ──
  if (command === 'nowplaying' || command === 'np') {
    if (!currentSong) return message.reply('Ga ada lagu yang lagi main bro');

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('▶️ Now Playing')
      .setDescription(`**[${currentSong.title}](${currentSong.url})**`)
      .addFields(
        { name: 'Durasi', value: currentSong.duration, inline: true },
        { name: 'Request by', value: currentSong.requestedBy || 'Unknown', inline: true }
      )
      .setThumbnail(currentSong.thumbnail);

    return message.reply({ embeds: [embed] });
  }

  // ── 24/7 ──
  if (command === '247') {
    if (!vc) return message.reply('Masuk voice dulu bro');
    mode247 = !mode247;
    if (mode247) {
      if (!connection) await connect(vc);
      if (!isPlaying) await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
      return message.reply('24/7 ON 🔥 Bot ga akan keluar VC sampai `k!leave`');
    } else {
      return message.reply('24/7 OFF 😴');
    }
  }

  // ── LEAVE ──
  if (command === 'leave') {
    if (!connection) return message.reply('Ga di voice bro');
    manualLeave = true;
    player.stop();
    connection.destroy();
    connection = null;
    currentVC = null;
    queue = [];
    currentSong = null;
    isPlaying = false;
    mode247 = false;
    return message.reply('Leave 👋');
  }
});

client.login(process.env.TOKEN);
