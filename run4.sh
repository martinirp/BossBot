#!/bin/bash
sshpass -p '123' ssh -p 8022 u0_a138@192.168.3.141 -o StrictHostKeyChecking=no "proot-distro login debian -- bash -c 'cd ~/BossBot && head -n 220 notifier.js | tail -n 50'"
