// index.js
const { Client, GatewayIntentBits, Events, ActivityType, EmbedBuilder } = require('discord.js');
const { pool, initDB } = require('./db');
require('dotenv').config();

// --- 設定 ---
const STATUS_UPDATE_INTERVAL = 60 * 1000; // 1分

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ],
});

let userTimes = new Map();

// --- データ永続化のための関数 (PostgreSQL版) ---

async function loadData() {
    try {
        const { rows } = await pool.query('SELECT user_id, total_time FROM user_times');
        for (const row of rows) {
            userTimes.set(row.user_id, { totalTime: parseInt(row.total_time, 10), joinTime: null });
        }
        console.log('データベースからデータを正常に読み込みました。');
    } catch (error) {
        console.error('データベースの読み込み中にエラーが発生しました:', error);
    }
}

async function updateUserTime(userId, sessionTime) {
    try {
        const query = `
            INSERT INTO user_times (user_id, total_time)
            VALUES ($1, $2)
            ON CONFLICT (user_id)
            DO UPDATE SET total_time = user_times.total_time + $2;
        `;
        await pool.query(query, [userId, sessionTime]);
    } catch (error) {
        console.error(`ユーザー時間の更新中にエラーが発生しました (ユーザーID: ${userId}):`, error);
    }
}

// --- Botのイベントリスナー ---

client.once(Events.ClientReady, async () => {
    console.log(`ログインしました: ${client.user.tag}`);
    await initDB();
    await loadData();
    setInterval(updateStatus, STATUS_UPDATE_INTERVAL);
    updateStatus();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.guild.id !== process.env.GUILD_ID || newState.member.user.bot) return;

    const userId = newState.id;
    if (!userTimes.has(userId)) {
        userTimes.set(userId, { totalTime: 0, joinTime: null });
    }
    const userData = userTimes.get(userId);

    const wasCountable = oldState.channelId && !oldState.serverMute && !oldState.selfMute;
    const isCountable = newState.channelId && !newState.serverMute && !newState.selfMute;

    if (wasCountable && !isCountable) {
        if (userData.joinTime) {
            const sessionTime = Date.now() - userData.joinTime;
            userData.totalTime += sessionTime;
            userData.joinTime = null;
            updateUserTime(userId, sessionTime); // データベースを更新
            console.log(`${newState.member.displayName} の計測を停止。セッション時間: ${Math.floor(sessionTime / 1000)}秒。データベースを更新しました。`);
        }
    } else if (!wasCountable && isCountable) {
        userData.joinTime = Date.now();
        console.log(`${newState.member.displayName} の計測を開始。`);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'te') return;

    const guild = interaction.guild;
    if (!guild) return;

    // 現在のセッション時間を含めたランキングデータを生成
    const displayData = [];
    for (const [userId, data] of userTimes.entries()) {
        let userTotalTime = data.totalTime;
        if (data.joinTime) {
            userTotalTime += Date.now() - data.joinTime;
        }
        if (userTotalTime > 0) {
            displayData.push({ userId, totalTime: userTotalTime });
        }
    }

    displayData.sort((a, b) => b.totalTime - a.totalTime);

    if (displayData.length === 0) {
        await interaction.reply('まだ誰も作業時間を記録していません。');
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('ユーザー別 作業時間ランキング')
        .setColor(0x0099FF)
        .setTimestamp();

    let description = '';
    for (const item of displayData.slice(0, 25)) {
        try {
            const member = await guild.members.fetch(item.userId);
            const time = formatTime(item.totalTime);
            description += `**${member.displayName}**: ${time}\n`;
        } catch (error) {
            console.error(`メンバーの取得に失敗しました: ${item.userId}`);
            // メンバーが見つからない場合はIDで表示
            const time = formatTime(item.totalTime);
            description += `**${item.userId}**: ${time}\n`;
        }
    }
    embed.setDescription(description);

    await interaction.reply({ embeds: [embed] });
});


// --- 補助関数 ---
function updateStatus() {
    let totalMilliseconds = 0;
    for (const data of userTimes.values()) {
        totalMilliseconds += data.totalTime;
        if (data.joinTime) {
            totalMilliseconds += Date.now() - data.joinTime;
        }
    }
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((totalMilliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const statusText = `合計作業: ${hours}時間${minutes}分`;
    client.user.setActivity(statusText, { type: ActivityType.Watching });
}

function formatTime(ms) {
    if (ms < 1000) return `1秒未満`;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}時間 ${minutes}分 ${seconds}秒`;
}

client.login(process.env.DISCORD_TOKEN);
