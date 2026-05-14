import socket
import os
import subprocess
import time

# Termal yazıcı bağlantı ayarları
# Eğer yazıcı ağa bağlıysa (Ethernet/Wi-Fi), PRINTER_TYPE="network" yapın ve IP'yi yazın.
# Eğer yazıcı USB ile bilgisayara/kasa PC'sine bağlıysa PRINTER_TYPE="usb" yapın ve yazıcı adını yazın.

PRINTER_TYPE = os.environ.get("KITCHEN_PRINTER_TYPE", "network") # "network" veya "usb"
PRINTER_IP = os.environ.get("KITCHEN_PRINTER_IP", "192.168.1.101") # Ağ yazıcısı IP'si
PRINTER_PORT = int(os.environ.get("KITCHEN_PRINTER_PORT", 9100)) # Standart ESC/POS portu
PRINTER_NAME = os.environ.get("KITCHEN_PRINTER_NAME", "Xprinter_XP_80C") # USB/CUPS Yazıcı Adı (macOS/Linux)

# Türkçe karakterleri İngilizce'ye çevirme (Termal yazıcılarda karakter bozulmasını %100 önlemek için)
def tr_to_eng(text: str) -> str:
    if not text:
        return ""
    replacements = {
        'ı': 'i', 'I': 'I', 'İ': 'I', 'ğ': 'g', 'Ğ': 'G', 
        'ü': 'u', 'Ü': 'U', 'ş': 's', 'Ş': 'S', 'ö': 'o', 
        'Ö': 'O', 'ç': 'c', 'Ç': 'C'
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text

def print_kitchen_receipt(table_name: str, items: list[dict]):
    if not items:
        return
        
    # Temel ESC/POS Komutları (XPrinter XP-80 uyumlu)
    ESC = b'\x1b'
    GS = b'\x1d'
    INITIALIZE = ESC + b'@'
    ALIGN_CENTER = ESC + b'a\x01'
    ALIGN_LEFT = ESC + b'a\x00'
    BOLD_ON = ESC + b'E\x01'
    BOLD_OFF = ESC + b'E\x00'
    TEXT_DOUBLE = GS + b'!\x11'
    TEXT_NORMAL = GS + b'!\x00'
    FEED_AND_CUT = GS + b'V\x42\x00' # Partial cut
    
    # Fiş verisini oluştur (Raw Bytes)
    data = INITIALIZE
    data += ALIGN_CENTER
    data += TEXT_DOUBLE + BOLD_ON
    data += f"MASA: {tr_to_eng(table_name)}\r\n".encode('ascii', errors='replace')
    data += TEXT_NORMAL + BOLD_OFF
    data += b"--------------------------------\r\n"
    data += ALIGN_LEFT
    
    for item in items:
        qty = item['quantity']
        name = tr_to_eng(item['product_name'])
        opts = tr_to_eng(item.get('selected_options'))
        
        data += TEXT_DOUBLE
        data += f"{qty}x {name}\r\n".encode('ascii', errors='replace')
        data += TEXT_NORMAL
        
        if opts:
            data += f"   * {opts}\r\n".encode('ascii', errors='replace')
    
    data += b"--------------------------------\r\n"
    data += b"\r\n\r\n\r\n\r\n\r\n" # Yazıcı kafasının kesme noktasına gelmesi için boşluk
    data += FEED_AND_CUT
    
    # Yazdırma İşlemi
    if PRINTER_TYPE == "network" and PRINTER_IP:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(5)
                s.connect((PRINTER_IP, PRINTER_PORT))
                s.sendall(data)
                # Xprinter gibi cihazlar için tamponun (buffer) dolmasını/yazdırılmasını beklemek gerekebilir
                time.sleep(0.5) 
            print(f"Mutfak Fişi Yazdırıldı (Network: {PRINTER_IP}:{PRINTER_PORT})")
        except Exception as e:
            print(f"Yazıcı bağlantı hatası ({PRINTER_IP}): {e}")
            _simulate_print(data)
            
    elif PRINTER_TYPE == "usb" and PRINTER_NAME:
        try:
            # macOS / Linux için CUPS (lpr) kullanarak raw yazdırma
            tmp_file = "/tmp/kitchen_receipt.bin"
            with open(tmp_file, "wb") as f:
                f.write(data)
            subprocess.run(["lpr", "-P", PRINTER_NAME, "-o", "raw", tmp_file], check=True)
            print(f"Mutfak Fişi Yazdırıldı (USB/CUPS: {PRINTER_NAME})")
        except Exception as e:
            print(f"USB Yazıcı hatası ({PRINTER_NAME}): {e}")
            _simulate_print(data)
    else:
        _simulate_print(data)

def _simulate_print(data: bytes):
    print("\n=== MUTFAK YAZICISI SIMULASYONU ===")
    print(data.decode('ascii', errors='replace'))
    print("===================================\n")
    print("Not: Gerçek yazdırma için printer.py içindeki PRINTER_IP veya PRINTER_NAME ayarlarını yapın.")
