#!/usr/bin/env python3
"""
Android Automation using uiautomator2
Installation: pip install uiautomator2
"""

import uiautomator2 as u2
import time
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AndroidAutomation:
    def __init__(self, device_id=None):
        """Initialize connection to Android device"""
        if device_id:
            self.d = u2.connect(device_id)
        else:
            self.d = u2.connect()
        logger.info(f"Connected to device: {self.d.info}")
    
    def open_app(self, package_name):
        """Open an app by package name"""
        self.d.app_start(package_name)
        logger.info(f"Opening app: {package_name}")
        time.sleep(2)
    
    def close_app(self, package_name):
        """Close an app by package name"""
        self.d.app_stop(package_name)
        logger.info(f"Closing app: {package_name}")
    
    def click_element(self, text=None, resource_id=None, description=None):
        """Click element by text, resource_id, or description"""
        if text:
            self.d(text=text).click()
            logger.info(f"Clicked element with text: {text}")
        elif resource_id:
            self.d(resourceId=resource_id).click()
            logger.info(f"Clicked element with resourceId: {resource_id}")
        elif description:
            self.d(description=description).click()
            logger.info(f"Clicked element with description: {description}")
        time.sleep(1)
    
    def input_text(self, text, resource_id=None, text_selector=None):
        """Input text into element"""
        if resource_id:
            self.d(resourceId=resource_id).set_text(text)
            logger.info(f"Input text into resourceId: {resource_id}")
        elif text_selector:
            self.d(text=text_selector).set_text(text)
            logger.info(f"Input text into element with text: {text_selector}")
        time.sleep(1)
    
    def scroll_down(self):
        """Scroll down"""
        self.d(scrollable=True).scroll.toEnd()
        logger.info("Scrolled down")
        time.sleep(1)
    
    def scroll_up(self):
        """Scroll up"""
        self.d(scrollable=True).scroll.toBeginning()
        logger.info("Scrolled up")
        time.sleep(1)
    
    def take_screenshot(self, filename="screenshot.png"):
        """Take screenshot"""
        self.d.screenshot(filename)
        logger.info(f"Screenshot saved: {filename}")
    
    def get_current_activity(self):
        """Get current activity"""
        activity = self.d.current_activity()
        logger.info(f"Current activity: {activity}")
        return activity
    
    def wait_for_element(self, text=None, timeout=10):
        """Wait for element to appear"""
        if text:
            self.d(text=text).wait(timeout=timeout)
            logger.info(f"Element with text '{text}' appeared")
    
    def swipe_left(self):
        """Swipe left"""
        self.d.swipe(0.8, 0.5, 0.2, 0.5)
        logger.info("Swiped left")
        time.sleep(1)
    
    def swipe_right(self):
        """Swipe right"""
        self.d.swipe(0.2, 0.5, 0.8, 0.5)
        logger.info("Swiped right")
        time.sleep(1)

def main():
    """Example usage"""
    # Initialize automation
    automation = AndroidAutomation()
    
    # Example: Open Settings app
    # automation.open_app("com.android.settings")
    
    # Example: Click element
    # automation.click_element(text="Display")
    
    # Example: Input text
    # automation.input_text("Hello World", resource_id="com.android.settings:id/search")
    
    # Example: Scroll
    # automation.scroll_down()
    
    # Example: Take screenshot
    # automation.take_screenshot("test_screenshot.png")
    
    logger.info("Automation completed!")

if __name__ == "__main__":
    main()
