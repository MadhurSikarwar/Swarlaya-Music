import pathlib

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\index.html')
content = target.read_text(encoding='utf-8')

# Check if html2pdf is already there
if "html2pdf.bundle.min.js" not in content:
    # Insert right before <script src="catalogue.js">
    insert_str = '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>\n  '
    content = content.replace('<script src="catalogue.js"></script>', insert_str + '<script src="catalogue.js"></script>')
    target.write_text(content, encoding='utf-8')
    print("Added html2pdf.js to index.html")
else:
    print("html2pdf.js already in index.html")
