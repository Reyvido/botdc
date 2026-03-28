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
  getVoiceConnection,
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

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play }
});

let queue = [];
let currentSong = null;
let isPlaying = false;
let mode247 = false;
let manualLeave = false;
let currentVC = null;
let currentGuildId = null;

const PREFIX = 'k!';
const DEFAULT_URL = "https://www.youtube.com/watch?v=jfKfPfyJRdk";

// ─────────────────────────────────────────
// HELPER: ambil koneksi aktif
// ─────────────────────────────────────────
function getConn() {
  if (!currentGuildId) return null;
  return getVoiceConnection(currentGuildId);
}

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
// CONNECT — simplified, no retry loop
// ─────────────────────────────────────────
async function connect(vc) {
  manualLeave = false;
  currentVC = vc;
  currentGuildId = vc.guild.id;

  // Kalau udah ada koneksi di guild ini, reuse aja
  const existing = getVoiceConnection(vc.guild.id);
  if (existing && existing.state.status === VoiceConnectionStatus.Ready) {
    console.log('Reuse existing connection');
    existing.subscribe(player);
    return;
  }

  // Destroy dulu kalau ada koneksi lama yang ga ready
  if (existing) {
    try { existing.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  const conn = joinVoiceChannel({
    channelId: vc.id,
    guildId: vc.guild.id,
    adapterCreator: vc.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 30_000);
  } catch (err) {
    conn.destroy();
    throw new Error('Gagal connect ke voice channel, coba lagi bro');
  }

  conn.subscribe(player);
  console.log(`Connected ke: ${vc.name}`);

  // Handler disconnect — cukup reconnect sekali, ga loop
  conn.on(VoiceConnectionStatus.Disconnected, async () => {
    if (manualLeave) return;
    console.log('Disconnected, coba reconnect...');
    try {
      await Promise.race([
        entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
        entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log('Reconnect berhasil');
    } catch {
      // Gagal reconnect, coba join ulang setelah 5 detik
      try { conn.destroy(); } catch {}
      if (!manualLeave && currentVC) {
        setTimeout(async () => {
          try {
            await connect(currentVC);
            if (mode247 && !isPlaying) {
              await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
            }
          } catch (e) {
            console.error('Gagal rejoin:', e.message);
          }
        }, 5000);
      }
    }
  });
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
  console.log('Idle — queue:', queue.length, '| 247:', mode247);
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
      return message.reply(`❌ ${err.message}`);
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
      const conn = getConn();
      if (!conn || conn.state.status !== VoiceConnectionStatus.Ready) {
        await connect(vc);
      }

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
      const conn = getConn();
      if (!conn || conn.state.status !== VoiceConnectionStatus.Ready) {
        await connect(vc);
      }
      if (!isPlaying) {
        await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
      }
      return message.reply('24/7 ON 🔥 Bot ga akan keluar VC sampai `k!leave`');
    } else {
      return message.reply('24/7 OFF 😴');
    }
  }

  // ── LEAVE ──
  if (command === 'leave') {
    const conn = getConn();
    if (!conn) return message.reply('Ga di voice bro');
    manualLeave = true;
    player.stop();
    conn.destroy();
    currentVC = null;
    currentGuildId = null;
    queue = [];
    currentSong = null;
    isPlaying = false;
    mode247 = false;
    return message.reply('Leave 👋');
  }
});

client.login(process.env.TOKEN);
