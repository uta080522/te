const { Client, GatewayIntentBits, Events, ActivityType, PermissionsBitField } = require('discord.js');
const { pool, initDB } = require('./db');
require('dotenv').config();

const STATUS_UPDATE_INTERVAL = 60 * 1000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let userTimes = new Map();

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

async function addTimeToAllUsers(ms) {
    try {
        await pool.query('UPDATE user_times SET total_time = total_time + $1', [ms]);
        for (const data of userTimes.values()) {
            data.totalTime += ms;
        }
        console.log(`全ユーザーに ${ms}ms を追加しました。`);
    } catch (error) {
        console.error('全ユーザーへの時間追加中にエラーが発生しました:', error);
    }
}

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
            updateUserTime(userId, sessionTime);
            console.log(`${newState.member.displayName} の計測を停止。セッション時間: ${Math.floor(sessionTime / 1000)}秒。データベースを更新しました。`);
        }
    } else if (!wasCountable && isCountable) {
        userData.joinTime = Date.now();
        console.log(`${newState.member.displayName} の計測を開始。`);
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild || !message.content.startsWith('t!add')) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply('このコマンドを使用するには管理者権限が必要です。');
    }

    const args = message.content.slice('t!add'.length).trim().split(/ +/);
    const timeArg = args.shift();
    if (!timeArg) {
        return message.reply('時間を指定してください。例: t!add 1h');
    }

    const msToAdd = parseTime(timeArg);
    if (msToAdd === null) {
        return message.reply('時間の形式が無効です。例: 1h, 30m');
    }

    await addTimeToAllUsers(msToAdd);
    await updateStatus();

    const hours = Math.floor(msToAdd / (1000 * 60 * 60));
    const minutes = Math.floor((msToAdd % (1000 * 60 * 60)) / (1000 * 60));
    let timeString = '';
    if (hours > 0) timeString += `${hours}時間`;
    if (minutes > 0) timeString += `${minutes}分`;

    message.reply(`全ユーザーの合計作業時間に${timeString}を追加しました。`);
});

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

function parseTime(timeString) {
    const match = timeString.match(/^(\d+)([hm])$/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'h') {
        return value * 3600000;
    } else if (unit === 'm') {
        return value * 60000;
    }
    return null;
}

client.login(process.env.DISCORD_TOKEN);
