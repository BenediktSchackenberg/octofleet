#!/bin/bash
# Run this with sudo to fix SMB share for Windows PXE install

# Add wininstall share to smb.conf
cat >> /etc/samba/smb.conf << 'EOF'

[wininstall]
   path = /srv/wininstall
   browseable = yes
   read only = yes
   guest ok = yes
   public = yes
   force user = root
EOF

# Restart samba
systemctl restart smbd

echo "SMB share configured. Test with:"
echo "smbclient -L //192.168.0.5 -N"
