const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require("dotenv").config();
const fs = require('fs');
const Discord = require('discord.js');
const CronJob = require('node-cron');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const client = new Client({
intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
],
});

const strikesFilePath = 'strikes.json';
const guildId = "674079915515052058";
const staffRole = "749115443721273445";
const violations = "1134347089678172281";
const staffChat = "1134347106824491029";
const strikeRoles = ["1134420601658937475", "1134420636127731823", "1134420661406793819"];
const bannableRoleId = "1134420687507947650";

let strikesMap = readStrikesData();

function readStrikesData() {
    try {
        const data = fs.readFileSync(strikesFilePath);
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading strikes data:', error.message);
    return {};
    }
}

function writeStrikesData(strikesData) {
    try {
        fs.writeFileSync(strikesFilePath, JSON.stringify(strikesData, null, 2));
    } catch (error) {
        console.error('Error writing strikes data:', error.message);
    }
}

function checkExpiredStrikes() {
    const nowTimestamp = Date.now();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    for (const userId in strikesMap) {
        const userStrikes = strikesMap[userId];
        const lastStrikeTimestamp = userStrikes.lastStrike;
        const bannableTimestamp = userStrikes.bannableTimestamp;
        if (lastStrikeTimestamp) {
            const thirtyDaysInMs = 30;// * 24 * 60 * 60 * 1000;
            const timeElapsed = nowTimestamp - lastStrikeTimestamp;
            console.log(timeElapsed);
            if (timeElapsed >= thirtyDaysInMs) {
                // Expired strike, remove it
                removeStrikeRoles(guild, userId);
                userStrikes.lastStrike = null;
                userStrikes.strikes = 0;
                writeStrikesData(strikesMap);
            }
        }
    }
}

async function removeStrikeRoles(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        if (!member) {
            console.error('Member not found:', userId);
            return;
        }
        console.log(`Removing strike role from ${userId}`);
        for (const roleId of strikeRoles) {
            const roleToRemove = guild.roles.cache.get(roleId);
            if (!roleToRemove) {
                console.error('Role not found:', roleId);
                continue;
            }

            try {
                await member.roles.remove(roleToRemove);
            } catch (error) {
                console.error('Error removing role:', error);
            }
        }
    } catch (error) {
        console.error('Error fetching member:', error);
    }
}

function checkExpiredBannable() {
    const nowTimestamp = Date.now();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    for (const userId in strikesMap) {
        const userStrikes = strikesMap[userId];
        const bannableTimestamp = userStrikes.bannableTimestamp;
        if (bannableTimestamp) {
            const ninetyDaysInMs = 90;// * 24 * 60 * 60 * 1000;
            const timeElapsed = nowTimestamp - bannableTimestamp;
            console.log(timeElapsed);
            if (timeElapsed >= ninetyDaysInMs) {
                // expired bannable, remove it
                removeBannableRole(guild, userId);

                userStrikes.bannableTimestamp = null;
                writeStrikesData(strikesMap);
            }
        }
    }
}

async function removeBannableRole(guild, userId) {
    const member = guild.members.cache.get(userId);
        if (member) {
            const bannableRole = guild.roles.cache.get(bannableRoleId);
            if (bannableRole) {
                console.log(`Removing bannable role from ${userId}`);
                try {
                    await member.roles.remove(bannableRole);
                } catch (error) {
                    console.error('Error removing bannable role:', error);
                }
            }
        }
}

function checkObsoleteEntries() {
    for (const userId in strikesMap) {
        const userStrikes = strikesMap[userId];
        const lastStrikeTimestamp = userStrikes.lastStrike;
        const bannableTimestamp = userStrikes.bannableTimestamp;
        
        if (lastStrikeTimestamp === null && bannableTimestamp === null) {
            console.log(`Deleting strike data entry for ${userId}`);
            delete strikesMap[userId];
        }
    }

    writeStrikesData(strikesMap);
}

async function addStrike(userId, username, guild, staffMember, reason) {
    const userStrikes = strikesMap[userId] || { strikes: 0, lastStrike: null, reasons: [] };
    const strikeCount = userStrikes.strikes;
    const newStrikeCount = Math.min(strikeCount + 1, 3);
    const nowTimestamp = Date.now();
    userStrikes.reasons.push(reason);

    const strikeRoleIndex = newStrikeCount - 1;
    if (strikeRoleIndex >= 0 && strikeRoleIndex < strikeRoles.length) {
        const strikeRole = guild.roles.cache.get(strikeRoles[strikeRoleIndex]);
        if (strikeRole) {
            try {
                const member = guild.members.cache.get(userId);
                if (member) {
                    if (member.roles.cache.has(bannableRoleId)) {
                        alertStaff(userId, username);
                        return newStrikeCount;
                    }
                    // Remove any existing strike roles before adding the new one
                    for (const roleId of strikeRoles) {
                        const roleToRemove = guild.roles.cache.get(roleId);
                        if (roleToRemove) {
                            await member.roles.remove(roleToRemove);
                        }
                    }

                    // Add the new strike role
                    await member.roles.add(strikeRole);
                }
            } catch (error) {
                console.error('Error adding strike role:', error);
            }
        }
    }

    // Update the strikes data in strikesMap
    strikesMap[userId] = { 
        username, 
        strikes: newStrikeCount, 
        lastStrike: nowTimestamp,
        bannableTimestamp: newStrikeCount === 3 ? nowTimestamp : null, // Set the bannable timestamp if the user has 3 strikes
        reasons: userStrikes.reasons
    };
    writeStrikesData(strikesMap); // Save the updated strikes data

    console.log(`Given strike ${newStrikeCount} to ${username} (${userId})`);
    if (newStrikeCount === 3) {
        const bannableRole = guild.roles.cache.get(bannableRoleId);
        if (bannableRole) {
            try {
                const member = guild.members.cache.get(userId);
                if (member) {
                    await member.roles.add(bannableRole);
                    console.log(`Given bannable role to ${username}`);

                }
            } catch (error) {
                console.error('Error adding bannable role:', error);
            }
        }
    }

    if (newStrikeCount <= 3) {
        sendViolationMessage(guild, userId, username, newStrikeCount, reason, staffMember);
    }

    return newStrikeCount;
}

async function messageUser(userId, newStrikeCount, reason) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(`You have received strike number ${newStrikeCount} for the following reason: ${reason}`);
        return true;
    } catch (error) {
        console.error('Error sending direct message:', error);
        return false;
    }
}

function alertStaff(userId, username) {
    const staffChannel = client.channels.cache.get(staffChat);
    if (staffChannel && staffChannel instanceof Discord.TextChannel) {
        console.log(`${username} (${userId}) was struck with bannable, alerting staff...`);
        staffChannel.send(`<@${staffRole}> User ${username} (<@${userId}>) has been struck while having bannable.`);
    } else {
        console.error('Staff chat channel not found or is not a text channel.');
    }
}

async function sendViolationMessage(guild, userId, username, strikeCount, reason, staffMemberId) {
    const violationsChannel = guild.channels.cache.get(violations);
    if (violationsChannel) {
        try {
            const user = guild.members.cache.get(userId);
            if (user.roles.cache.has(bannableRoleId)) {
                hasBannable = "Yes";
            } else {
                hasBannable = "No";
            }

            if (strikeCount === 3) {
                givenBannable = "Yes";
                embedColor = 0x993301;
            } else if (strikeCount === 2) {
                givenBannable = "No";
                embedColor = 0x9a6601;
            } else {
                givenBannable = "No";
                embedColor = 0xcc9900;
            }
            



            strikeCountString = strikeCount.toString();
            const staffMember = guild.members.cache.get(staffMemberId);

            console.log("Sending violation message...")
            const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(`Strike ${strikeCount} given to <@${userId}>:`)
            .addFields({ name: 'Reason:', value: reason })
            .addFields({ name: 'Strike number:', value: strikeCountString, inline: true })
            .addFields({ name: 'Has bannable:', value: hasBannable, inline: true })
            .addFields({ name: 'Given bannable:', value: givenBannable, inline: true })
            .setTimestamp()
            .setFooter({ text: staffMember.user.username, iconURL: staffMember.user.avatarURL() });
            await violationsChannel.send({
                embeds: [embed]
            });
        } catch (error) {
            console.error('Error sending violation message:', error);
        }
    } else {
        console.error('Violations channel not found or is not a text channel.');
    }
}

async function editViolationMessage(messageId, newReason) {
    const violationsChannel = client.channels.cache.get(violations);
    if (violationsChannel) {
        try {
            const message = await violationsChannel.messages.fetch(messageId);
            if (message) {
                // Extract the existing embed from the message
                const oldEmbed = message.embeds[0];

                // Update the reason field in the embed with the new reason
                oldEmbed.fields.find(field => field.name === 'Reason:').value = newReason;

                // Edit the message with the updated embed
                await message.edit({ embeds: [oldEmbed] });
                console.log(`Violation message with ID ${messageId} edited successfully.`);
                return `Violation message with ID ${messageId} has been edited with the new reason: ${newReason}`;
            } else {
                console.log(`Message with ID ${messageId} not found.`);
                return `Message with ID ${messageId} not found.`;
            }
        } catch (error) {
            console.error('Error editing violation message:', error);
            return `Error editing violation message.`;
        }
    } else {
        console.error('Violations channel not found or is not a text channel.');
        return `Channel not found or is not a text channel.`;
    }
}

function msToDays(timestamp) {
    const nowTimestamp = Date.now();
    const timeElapsed = nowTimestamp - timestamp;
    return Math.floor(timeElapsed / (1000 * 60 * 60 * 24));
}

// client.on('messageCreate', message => {
//     if (message.content === 'ping') {
//         message.reply('pong')
//     }
// })

const commands = [
    {
        name: 'strike',
        description: 'Strike a user.',
        options: [
        {
            name: 'user',
            type: 6,
            description: 'The user to strike.',
            required: true,
        },
        {
            name: 'reason',
            type: 3,
            description: 'The reason for the strike.',
            required: true,
        },
        ],
    },
    {
        name: 'editstrike',
        description: 'Edits the #violations message for a strike.',
        options: [
        {
            name: 'messageid',
            type: 3,
            description: 'The message id for the message to be edited.',
            required: true,
        },
        {
            name: 'reason',
            type: 3,
            description: 'The new reason for the strike.',
            required: true,
        },
        ],
    },
    {
        name: 'strikelist',
        description: 'Get the list of users with strikes.',
    },
    {
        name: 'checkstrikes',
        description: 'Checks for expired strikes and removes them.',
    },
    {
        name: 'removestrike',
        description: 'Remove a strike from a user.',
        options: [
        {
            name: 'user',
            type: 6,
            description: 'The user to remove the strike from.',
            required: true,
        },
        ],
    },
    {
        name: 'removebannable',
        description: 'Remove bannable from a user.',
        options: [
        {
            name: 'user',
            type: 6,
            description: 'The user to remove bannable from.',
            required: true,
        },
        ],
    },
    {
        name: 'removeall',
        description: "Completely removes all strikes and the bannable role from a user.",
        options: [
        {
            name: 'user',
            type: 6,
            description: 'The user to remove',
            required: true,
        },
        ],
    },
];

// Initialize the REST API client
const rest = new REST({ version: '9' }).setToken(process.env.TOKEN);

// Register the slash commands
(async () => {
try {
    console.log('Loading slash commands...');

    await rest.put(
    Routes.applicationGuildCommands('1134263304181792918', '674079915515052058'),
    { body: commands },
    );

    console.log('Successfully loaded slash commands.');
} catch (error) {
    console.error(error);
}
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Schedule the functions to run every 24 hours
    CronJob.schedule('0 0 * * *', () => {
        console.log('Checking for expired strikes...');
        checkExpiredStrikes();
        console.log('Checking for expired bannable roles...');
        checkExpiredBannable();
        console.log('Checking for obsolete strike data entries...');
        checkObsoleteEntries();
    });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, member } = interaction;
    const guild = member.guild;

    if (commandName === 'strike') {
        if (!member.roles.cache.has(staffRole)) {
            return interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
            });
        }
        
        const user = options.get('user')?.user;
        const reason = options.get('reason')?.value;
        const userStrikes = strikesMap[user.id] || { strikes: 0, lastStrike: null };
        const strikeCount = userStrikes.strikes;

        const newStrikeCount = addStrike(user.id, user.username, guild, member.id, reason);
        
        const userr = guild.members.cache.get(user.id);
        if (userr.roles.cache.has(bannableRoleId)) {
            return interaction.reply({
                content: `<@${user.id}> has bannable, alerting staff...`,
                ephemeral: true,
                });
        }
        
        if (strikeCount >= 3) {
            return interaction.reply({
            content: "<@${user.id}> already has 3 strikes.",
            ephemeral: true,
            });
        }

        messageSent = messageUser(user.id, strikeCount + 1, reason);

        if (strikeCount === 2) {
            if (messageSent) {
                return interaction.reply({
                content: `<@${user.id}> has been given strike 3 and the bannable role for the reason: ${reason}`,
                ephemeral: true,
                });
            } else {
                return interaction.reply({
                    content: `<@${user.id}> has been given strike 3 and the bannable role for the reason: ${reason}, but there was an issue sending a dm to the user.`,
                    ephemeral: true,
                    });
            }
        }
        if (messageSent) {
            return interaction.reply({
                content: `<@${user.id}> has been given strike number ${strikeCount + 1} for the reason: ${reason}`,
                ephemeral: true,
            });
        } else {
            return interaction.reply({
                content: `<@${user.id}> has been given strike number ${strikeCount + 1} for the reason: ${reason}, but there was an issue sending a dm to the user.`,
                ephemeral: true,
            });
        }



    } else if (commandName === 'strikelist') {
        if (!member.roles.cache.has(staffRole)) {
            return interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
            });
        }

        let listMessage = '';

        for (const userId in strikesMap) {
            const userStrikes = strikesMap[userId];
            const strikeCount = userStrikes.strikes;
            const reasons = userStrikes.reasons.join('\n');
            const lastStrikeTimestamp = userStrikes.lastStrike;
            const bannableTimestamp = userStrikes.bannableTimestamp;

            let lastStrikeDaysAgo = 'N/A';
            let bannableDaysAgo = 'N/A';

            if (lastStrikeTimestamp) {
                lastStrikeDaysAgo = msToDays(lastStrikeTimestamp);
            }

            if (bannableTimestamp) {
                bannableDaysAgo = msToDays(bannableTimestamp);
            }

            listMessage += `User: <@${userId}>\n`;
            listMessage += "```\n"
            listMessage += `Strike Count: ${strikeCount}\n`;
            listMessage += `Days Since Last Strike: ${lastStrikeDaysAgo}\n`;
            listMessage += `Days Since Bannable: ${bannableDaysAgo}\n`;
            listMessage += `Reasons:\n${reasons}\n`;
            listMessage += "```\n"
        }

        if (listMessage.length > 0) {
            return interaction.reply({
                content: listMessage,
            });
        } else {
            return interaction.reply({
                content: 'No users found.',
            });
        }



    } else if (commandName === 'checkstrikes') {
        console.log('Checking for expired strikes...');
        checkExpiredStrikes();
        console.log('Checking for expired bannable roles...');
        checkExpiredBannable();
        console.log('Checking for obsolete strike data entries...');
        checkObsoleteEntries();
        return interaction.reply({
            content: "Strike list has been checked and expired strikes have been removed, if any.",
            ephemeral: true,
        });



    } else if (commandName === 'removestrike') {
    if (!member.roles.cache.has(staffRole)) {
    return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
    });
    }

    const user = options.get('user')?.user;
    if (!user) {
    return interaction.reply({
        content: 'User not found.',
        ephemeral: true,
    });
    }

    const userId = user.id;
    const userStrikes = strikesMap[userId];
    if (!userStrikes || userStrikes.strikes <= 0) {
    return interaction.reply({
        content: 'This user has no strikes.',
        ephemeral: true,
    });
    }

    const currentStrikeCount = userStrikes.strikes;
    if (currentStrikeCount <= 0) {
        return interaction.reply({
        content: 'This user has no strikes.',
        ephemeral: true,
        });
    } else if (currentStrikeCount === 1 && userStrikes.bannableTimestamp === null) {
        // If this is the last strike and the user is not bannable, remove the user's strike data entirely
        delete strikesMap[userId];
    } else if (currentStrikeCount === 1) {
        // If this is the last strike, also set lastStrike to null
        userStrikes.lastStrike = null;
        userStrikes.strikes -= 1;
        userStrikes.reasons.pop();
    } else {
        // Otherwise, decrement the strike count and remove the last reason
        userStrikes.strikes -= 1;
        userStrikes.reasons.pop();
    } 

    // Save the updated strikes data
    writeStrikesData(strikesMap);

    // Remove all strike roles from the user
    try {
        console.log(`Removing strike from ${userId}`)
    const memberToUpdate = guild.members.cache.get(userId);
    if (memberToUpdate) {
        for (const roleId of strikeRoles) {
        const roleToRemove = guild.roles.cache.get(roleId);
        if (roleToRemove) {
            await memberToUpdate.roles.remove(roleToRemove);
        }
        }
    }
    } catch (error) {
    console.error('Error removing strike roles:', error);
    }

    // Give back the appropriate strike role corresponding to the updated strike count
    if (currentStrikeCount > 1) {
    const strikeRoleIndex = currentStrikeCount - 2;
    if (strikeRoleIndex >= 0 && strikeRoleIndex < strikeRoles.length) {
        const strikeRoleToAdd = guild.roles.cache.get(strikeRoles[strikeRoleIndex]);
        if (strikeRoleToAdd) {
        try {
            const memberToUpdate = guild.members.cache.get(userId);
            if (memberToUpdate) {
            await memberToUpdate.roles.add(strikeRoleToAdd);
            }
        } catch (error) {
            console.error('Error adding strike role:', error);
        }
        }
    }
    }

    return interaction.reply({
    content: `Removed a strike from <@${userId}>. Be sure to delete the cooresponding #violations message and run /removebannable if relevant.`,
    ephemeral: true,
    });
} else if (commandName === 'removebannable') {
    if (!member.roles.cache.has(staffRole)) {
    return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
    });
    }

    const user = options.get('user')?.user;
    if (!user) {
    return interaction.reply({
        content: 'User not found.',
        ephemeral: true,
    });
    }

    const userId = user.id;
    const userStrikes = strikesMap[userId];
    if (!userStrikes) {
        return interaction.reply({
        content: 'This user is not bannable.',
        ephemeral: true,
        });
    }

    if (userStrikes.bannableTimestamp === null) {
        return interaction.reply({
        content: 'This user is not bannable.',
        ephemeral: true,
        });
    } else if (userStrikes.strikes <= 0) {
        // If there are no strikes, remove the user's strike data entirely
        delete strikesMap[userId];
    } else {
        // Otherwise, set bannableTimestamp to null
        userStrikes.bannableTimestamp = null;
    }

    writeStrikesData(strikesMap);

    // Remove the bannable role from the user
    try {
    const memberToUpdate = guild.members.cache.get(userId);
    if (memberToUpdate) {
        const bannableRole = guild.roles.cache.get(bannableRoleId);
        if (bannableRole) {
        await memberToUpdate.roles.remove(bannableRole);
        }
    }
    } catch (error) {
    console.error('Error removing bannable role:', error);
    }

    return interaction.reply({
    content: `Removed bannable from <@${userId}>.`,
    ephemeral: true,
    });
} else if (commandName === 'removeall') {
    if (!member.roles.cache.has(staffRole)) {
    return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
    });
    }

    const userOption = options.get('user');
    if (!userOption) {
    return interaction.reply({
        content: "User not found.",
        ephemeral: true,
    });
    }

    const userId = userOption.value;
    const userStrikes = strikesMap[userId];
    if (!userStrikes) {
    return interaction.reply({
        content: `<@${userId}> does not have any strikes.`,
        ephemeral: true,
    });
    }

    // Remove the user's entry from the strikesMap and update the file
    delete strikesMap[userId];
    writeStrikesData(strikesMap);

    // Fetch the user and their member object from the guild
    const user = await client.users.fetch(userId);
    const memberToDelete = guild.members.cache.get(userId);

    console.log(`Removing all strikes and bannable role from ${userId}...`);
    // Remove the strike roles
    for (const roleId of strikeRoles) {
    const roleToRemove = guild.roles.cache.get(roleId);
    if (roleToRemove) {
        try {
        await memberToDelete.roles.remove(roleToRemove);
        } catch (error) {
        console.error('Error removing role:', error);
        }
    }
    }

    // Remove the bannable role if the user has one
    const bannableRole = guild.roles.cache.get(bannableRoleId);
    if (bannableRole && memberToDelete.roles.cache.has(bannableRoleId)) {
    try {
        await memberToDelete.roles.remove(bannableRole);
    } catch (error) {
        console.error('Error removing bannable role:', error);
    }
    }

    return interaction.reply({
    content: `All strikes and bannable role have been removed for <@${userId}>.`,
    ephemeral: true,
    });
} else if (commandName === 'editstrike') {
    if (!member.roles.cache.has(staffRole)) {
        return interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
        });
    }

    const messageId = options.get('messageid')?.value;
    const newReason = options.get('reason')?.value;

    // Call the editViolationMessage function with the provided message ID and new reason
    returnMessage = (await editViolationMessage(messageId, newReason)).toString();
    return interaction.reply({
        content: returnMessage,
        ephemeral: true,
    });
}
});

process.on('beforeExit', () => {
    writeStrikesData(strikesMap);
});


client.login(process.env.TOKEN);