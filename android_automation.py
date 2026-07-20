#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Android Automation menggunakan uiautomator2
Dibuat untuk otomatisasi perangkat Android
"""

import uiautomator2 as u2
import time

class AndroidAutomation:
    def __init__(self, device_id=None):
        """
        Inisialisasi koneksi ke perangkat Android
        device_id: ID perangkat (opsional), jika None akan menggunakan perangkat pertama yang terdeteksi
        """
        if device_id:
            self.d = u2.connect(device_id)
        else:
            self.d = u2.connect()
        print(f"Terhubung ke perangkat: {self.d.device_info}")
    
    def tap_element(self, text=None, resource_id=None, description=None):
        """
        Menekan elemen berdasarkan teks, resource_id, atau deskripsi
        """
        if text:
            self.d(text=text).click()
            print(f"Menekan elemen dengan teks: {text}")
        elif resource_id:
            self.d(resourceId=resource_id).click()
            print(f"Menekan elemen dengan resource_id: {resource_id}")
        elif description:
            self.d(description=description).click()
            print(f"Menekan elemen dengan deskripsi: {description}")
    
    def input_text(self, text, input_text):
        """
        Memasukkan teks ke dalam elemen input
        """
        self.d(text=text).set_text(input_text)
        print(f"Memasukkan teks: {input_text}")
    
    def scroll_to_element(self, text):
        """
        Scroll sampai menemukan elemen dengan teks tertentu
        """
        self.d(text=text).scroll.to()
        print(f"Scroll ke elemen: {text}")
    
    def wait_for_element(self, text, timeout=10):
        """
        Menunggu elemen muncul
        """
        self.d.wait_activity(text, timeout)
        print(f"Menunggu elemen: {text}")
    
    def swipe(self, start_x, start_y, end_x, end_y, duration=0.5):
        """
        Melakukan gesture swipe
        """
        self.d.swipe(start_x, start_y, end_x, end_y, duration)
        print(f"Swipe dari ({start_x}, {start_y}) ke ({end_x}, {end_y})")
    
    def press_back(self):
        """
        Menekan tombol back
        """
        self.d.press("back")
        print("Menekan tombol back")
    
    def press_home(self):
        """
        Menekan tombol home
        """
        self.d.press("home")
        print("Menekan tombol home")
    
    def get_screenshot(self, filename="screenshot.png"):
        """
        Mengambil screenshot
        """
        self.d.screenshot(filename)
        print(f"Screenshot disimpan: {filename}")
    
    def launch_app(self, package_name):
        """
        Membuka aplikasi berdasarkan package name
        """
        self.d.app_start(package_name)
        print(f"Membuka aplikasi: {package_name}")
    
    def close_app(self, package_name):
        """
        Menutup aplikasi
        """
        self.d.app_stop(package_name)
        print(f"Menutup aplikasi: {package_name}")

# Contoh penggunaan
if __name__ == "__main__":
    # Buat instance otomatisasi
    automation = AndroidAutomation()
    
    # Contoh: Buka aplikasi
    # automation.launch_app("com.example.app")
    
    # Contoh: Tekan elemen
    # automation.tap_element(text="Login")
    
    # Contoh: Input teks
    # automation.input_text("Username", "user123")
    
    print("Otomatisasi siap digunakan!")
