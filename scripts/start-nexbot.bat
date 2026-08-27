@echo off
REM NexBot - one-shot starter (run via Task Scheduler so it survives the shell)
set PM2_HOME=D:\pm2-data
set NPM_CONFIG_CACHE=D:\npm-cache
cd /d D:\Nexbot
call pm2 start D:\Nexbot\ecosystem.config.js
call pm2 save