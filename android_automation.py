#!/usr/bin/env python3
"""
Android Automation dengan uiautomator2
Pastikan uiautomator2 sudah terinstall: pip install uiautomator2
"""

import uiautomator2 as u2
import time

class AndroidAutomation:
    def __init__(self, device_id=None):
        """
        Inisialisasi koneksi ke perangkat Android
        device_id: opsional, jika None akan menggunakan perangkat pertama yang terdeteksi
        """
        if device_id:
            self.d = u2.connect(device_id)
        else:
            self.d = u2.connect()
        print(f"Terhubung ke perangkat: {self.d.device_info}")
    
    def tap_element(self, text=None, resource_id=None, description=None):
        """Tap elemen berdasarkan text, resource_id, atau description"""
        if text:
            self.d(text=text).click()
            print(f"Men-tap elemen dengan text: {text}")
        elif resource_id:
            self.d(resourceId=resource_id).click()
            print(f"Men-tap elemen dengan resource_id: {resource_id}")
        elif description:
            self.d(description=description).click()
            print(f"Men-tap elemen dengan description: {description}")
    
    def input_text(self, text, input_text):
        """Input text ke elemen"""
        self.d(text=text).set_text(input_text)
        print(f"Menginput '{input_text}' ke elemen dengan text: {text}")
    
    def wait_element(self, text=None, timeout=10):
        """Tunggu elemen muncul"""
        if text:
            self.d(text=text).wait(timeout=timeout)
            print(f"Menunggu elemen dengan text: {text}")
    
    def swipe_screen(self, direction='up'):
        """Swipe layar"""
        if direction == 'up':
            self.d.swipe(0.5, 0.8, 0.5, 0.2)
        elif direction == 'down':
            self.d.swipe(0.5, 0.2, 0.5, 0.8)
        elif direction == 'left':
            self.d.swipe(0.8, 0.5, 0.2, 0.5)
        elif direction == 'right':
            self.d.swipe(0.2, 0.5, 0.8, 0.5)
        print(f"Swipe layar ke arah: {direction}")
    
    def press_key(self, key_code):
        """Tekan tombol (home, back, enter, dll)"""
        self.d.press(key_code)
        print(f"Menekan tombol: {key_code}")
    
    def screenshot(self, filename="screenshot.png"):
        """Ambil screenshot"""
        self.d.screenshot(filename)
        print(f"Screenshot disimpan: {filename}")
    
    def get_current_activity(self):
        """Dapatkan activity saat ini"""
        activity = self.d.current_activity()
        print(f"Activity saat ini: {activity}")
        return activity


# Contoh penggunaan
if __name__ == "__main__":
    # Inisialisasi otomatisasi
    automation = AndroidAutomation()
    
    # Contoh: tap elemen dengan text tertentu
    # automation.tap_element(text="Settings")
    
    # Contoh: input text
    # automation.input_text(text="Search", input_text="uiautomator2")
    
    # Contoh: swipe layar
    # automation.swipe_screen(direction='up')
    
    # Contoh: tekan tombol back
    # automation.press_key('back')
    
    print("Otomatisasi selesai!")
