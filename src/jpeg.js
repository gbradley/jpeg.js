/**
* jpeg.js - A RequireJS module to extract JPEG metadata.
*
* 
* Graham Bradley
* https://github.com/gbradley/jpeg.js
**/

// Rather than jumping through hoops getting Require inside a worker, just mock it.
if (typeof define === 'undefined') {
	var define = function(dependencies, callback) {
		callback();
	};
}

define([], function() {
	"use strict";

	// ! Helper methods

	/**
	 * Simple mixin.
	 *
	 * @param Function cls
	 * @param Object methods
	 */
	var build = function(cls, methods) {
		for (var x in methods) {
			cls.prototype[x] = methods[x];
		}
		return cls;
	};


	// ! Buffer

	/**
	* The Buffer class accepts a binary string and provides various manipulation methods.
	**/

	/**
	 * Constructor
	 *
	 * @param {String} data
	 */
	var Buffer = build(function Buffer(data) {
		this.data = data;
		this.endian = null;
		this.index = 0;
	}, {

		/**
		* Return the buffer length
		*
		* @return Number The length of the buffer
		**/
		length : function() {
			return this.data.length;
		},
		
		/**
		* Return the next character code in the buffer
		*
		* @return Number The character code
		**/
		nextByte : function() {
			return this.index == this.data.length ? null : (this.data.charCodeAt(this.index++) & 0xFF);
		},
			
		/**
		* Sets the byte order of the buffer, determined by the first two bytes in the buffer.
		*
		* @return Number 0 = big endian, 1 = little endian
		**/
		setByteOrder : function() {
			var a = this.getByteAt(0),
				b = this.getByteAt(1);
			this.endian = (a == 0x49 && b == 0x49) ? 1 : ((a == 0x4D && b == 0x4D) ? 0 : null);
			return this.endian;
		},
			
		/**
		* Checks the byte order of the buffer, determined by the 3rd / 4th bytes in the buffer.
		*
		* @return Boolean True if valid, otherwise false
		**/
		checkByteOrder : function() {
			return this.getByteAt(2 + this.endian) == 0x00 && this.getByteAt(3 - this.endian) == 0x2A;
		},
			
		/**
		* Returns the character code of the byte at the given offset
		*
		* @return Number
		**/
		getByteAt : function(offset) {
			return this.data.charCodeAt(offset) & 0xFF;
		},
		
		/**
		* Returns the short at the given offset
		*
		* @return Number
		**/
		getShortAt : function(offset) {
			var shrt = this.endian ? 
				(this.getByteAt(offset + 1) << 8) + this.getByteAt(offset) : 
				(this.getByteAt(offset) << 8) + this.getByteAt(offset + 1);
			if (shrt < 0) {
				shrt += 65536;
			}
			return shrt;
		},
			
		/**
		* Returns the long at the given offset
		*
		* @return Number
		**/
		getLongAt : function(offset) {
			var byte1 = this.getByteAt(offset),
				byte2 = this.getByteAt(offset + 1),
				byte3 = this.getByteAt(offset + 2),
				byte4 = this.getByteAt(offset + 3);

			var lng = this.endian ? 
				 (((((byte4 << 8) + byte3) << 8) + byte2) << 8) + byte1 : 
				 (((((byte1 << 8) + byte2) << 8) + byte3) << 8) + byte4;
			if (lng < 0) {
				lng += 4294967296;
			}
			return lng;
		},
			
		/**
		* Creates a new buffer using a substring of the current buffer, retaining endian-ness.
		*
		* @return ByteFuffer
		**/
		slice : function(offset, end) {
			return new Buffer(this.data.substring(offset, end), this.endian);
		}
		
	});


	// ! ExifReader

	/**
	* ExifReader class extracts EXIF, IPTC, GPS and thumbnail information from JPEG data.
	**/

	/**
	 * Constructor
	 */
	var ExifReader = build(function ExifReader() {
		this.error = null;
		this.exif = {};
		this.iptc = {};
		this.gps = {};
		this.thumbnail = null;
	}, {

		/**
		 * Process a binary string
		 *
		 * @param {String} data
		 * @return {Boolean}
		 */
		process : function(data) {
			var success = false,
				metadata = {
				exif : {},
				iptc : {},
				gps : {}
			};

			try {
				parse(metadata, new Buffer(data));
				this.metadata = metadata;
				success = true;
			} catch (e) {
				this.error = e;
			}
			this.metadata = metadata;
			return success;
		}
	});

	/**
	* Helper methods to convert Exif format to more useful ones.
	**/
	ExifReader.helpers = {

		exif : {
			/**
			 * Attempt to convert a DateTimeOriginal string to a valid date (object with day, month, year properties)
			 *
			 * @param string dateTimeOriginal
			 * @returns Object|null
			 */
			dateTimeOriginalToDateComponents : function(dateTimeOriginal) {
				var date = null,
					match = dateTimeOriginal.match(/^(\d{4})([:\/\- ])(\d{2})\2(\d{2})/);
				if (match) {
					
					var day = parseInt(match[4]),
						month = parseInt(match[3]),
						year = parseInt(match[1]);

					if (day && month && year && month <= 12 && day <= [,31,year % 4 ? 28 : 29,31,30,31,30,31,31,30,31,30,31][month]) {
						date = {
							day: day,
							month: month,
							year: year
						};
					}
				}
				return date;
			}
		},

		gps : {
			/**
			 * Attempt to convert a coordinate string and reference to a WSG84 decimal coordinate
			 *
			 * @param string coords
			 * @param string ref
			 * @returns Number|null
			 */
			degreesToDecimal : function (coords, ref) {
				var dec = 0,
					m = [1, 60, 3600],
					part;
				coords = coords.split(',');
				for (var i = 0; i < coords.length; i++) {
					part = coords[i].split('/');
					dec += (part[0] / part[1]) / m[i];
				}

				// Some EXIF returns the GPSLatitudeRef / GPSLongitudeRef flags with more than one
				// character (tag parsing looks fine so unsure what's going on), so only inspect the first char.
				ref = ref.split('')[0].toUpperCase();
				if (ref === 'S' || ref === 'W') {
					dec *= -1;
				}
				return (Number.isNaN || isNaN)(dec) ? null : dec;
			}
		},

		iptc : {
			/**
			 * Convert an IPTC keywords value to tag array
			 *
			 * @param mixed keywors
			 * @returns string
			 */
			keywordsToTags : function(keywords) {
				return Object.prototype.toString.call(keywords) === '[object Array]' ? keywords : keywords.split(',');
			}
		}
	};

	/**
	 * Parse the data inside a buffer and store tags inside a metadata object.
	 *
	 * @param {Object} metadata
	 * @param {Buffer} buffer
	 * @return void
	 */
	function parse(metadata, buffer) {

		// check JPEG validity
		if (!(buffer.nextByte() == 0xFF && buffer.nextByte() == 0xD8)) {
			throw new Error(ExifReader.Errors[1]);
		}

		// Attempt to find the SOF marker.
		sof(metadata, buffer);

		var block = [],
			blockLength,
			appx,
			advanced;
			
		// get the header for the first APP block
		for (var i = 0 ; i < 4 ; i++) {
			block[i] = buffer.nextByte();
		}

		while (block[0] == 0xFF && block[1] >= 0xE0 && block[1] <= 0xFE) {
		
			// determine the length of the current APP block
			blockLength = block[3] + 256 * block[2];
			
			// read in the APP data to a new buffer (subtract 2 from the block length as it includes the 2 bytes specifying the length!)
			advanced = buffer.index + blockLength - 2;
			appx = buffer.slice(buffer.index, advanced);
			buffer.index = advanced;
			
			// parse a specific APP block
			if (block[1] == 0xE1) {
				app1(metadata, appx);
			} else if (block[1] == 0xED) {
				app13(metadata, appx);
			}
		
			// get the header for the next APP block
			for (i = 0 ; i < 4 ; i++) {
				block[i] = buffer.nextByte();
			}
		}
	};

	/**
	 * Extract ImageWidth and ImageHeight by finding the SOF marker.
	 *
	 * @param {Object} metadata
	 * @param {Buffer} buffer
	 * @return void
	 */
	function sof(metadata, buffer) {
		var size = buffer.length(),
			marker, offset, length, advanced;

		while (buffer.index < size - 1) {

			while (buffer.nextByte() != 0xFF);
			marker = buffer.nextByte();

			do {
				offset = buffer.nextByte();
			} while (offset == 0xFF);

			length = buffer.nextByte();
			advanced = buffer.index + (length + 256 * offset) - 2;

			// check for SOF markers (note that 0xC4 points to huffman table, 0cC8 reserved etc; see http://www.xbdev.net/image_formats/jpeg/tut_jpg/jpeg_file_layout.php)
			if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].indexOf(marker) !== -1) {
				var sof = buffer.slice(buffer.index, advanced);
				metadata.exif.ImageHeight = sof.getShortAt(1);
				metadata.exif.ImageWidth = sof.getShortAt(3);
				break;
			}
			buffer.index = advanced;
		}

		buffer.index = 0;
	}

	/**
	 * Extract tags from an APP1 block.
	 *
	 * @param {Object} metadata
	 * @param {Buffer} buffer
	 * @return void
	 */
	function app1(metadata, buffer) {

		var length = buffer.length(),
			offset;
		
		// check that there's at least 8 bytes here (2 for length plus min 6 for EXIF)
		if (length < 8) {
			throw new Error(ExifReader.Errors[2]);
		}
			
		// see if 'Exif00' starts the buffer
		if (buffer.getByteAt(0) == 0x45 && buffer.getByteAt(1) == 0x78 && buffer.getByteAt(2) == 0x69 && buffer.getByteAt(3) == 0x66 && buffer.getByteAt(4) == 0 && buffer.getByteAt(5) == 0) {
			
			// check that there's at least 12 bytes here for IFDX
			if (length < 12) {
				throw new Error(ExifReader.Errors[3]);
			}
				
			// remove leading 'Exif00'
			buffer = buffer.slice(6, buffer.length());
			
			// determine the byte order
			if (buffer.setByteOrder() === null) {
				throw new Error(ExifReader.Errors[4]);
			}
				
			// check byte order (bytes 2, 3)
			if (!buffer.checkByteOrder()) {
				throw new Error(ExifReader.Errors[5]);
			}
			
			// get IFD0 offset (bytes 4 - 7)
			offset = buffer.getLongAt(4);
			if (offset > 0x0000FFFF) {
				throw new Error(ExifReader.Errors[6]);
			}
			
			// Parse the IFD block and get the offset to the next block.
			offset = ifd(metadata, buffer, offset);

			if (offset) {
				ifd(metadata, buffer, offset);

				// detect if thumbnail exists and is in JPG format; if so, grab data and store as data URI.
				var exif = metadata.exif;
				if (exif.Compression == 6 && exif.ThumbnailOffset && exif.ThumbnailSize) {
					metadata.thumbnail = buffer.slice(exif.ThumbnailOffset, exif.ThumbnailOffset + exif.ThumbnailSize).data;
				}
			}
		}
	};

	/**
	 * Extract IPTC tgas from with an APP13 block.
	 *
	 * @param {Object} metadata
	 * @param {Buffer} buffer
	 * @return void
	 */
	function app13(metadata, buffer) {
		
		var i = 0,
			length = buffer.length(),
			iptc = metadata.iptc,
			record, tagId, key, tagName,
			tagLength, extLength, chr, value;
			
		// find first IPTC marker
		while (i < length) {
			if (buffer.getByteAt(i) == 0x1C && buffer.getByteAt(i+1) < 0x0F) { 
				break;
			} else {
				i++;
			}
		}

		while (i < length) {

			// check for invalid starting byte or length
			if (buffer.getByteAt(i++) != 0x1C || (i + 4 >= length)) {
				return false;
			}
	 
			record = buffer.getByteAt(i++);
			tagId = buffer.getByteAt(i++);
			key = record + 'x' + tagId;
			chr = buffer.getByteAt(i);
			
			if (chr & 0x80) {
				// it's an extended tag
				extLength = ((chr & 0x7F) << 8) | buffer.getByteAt(i+1);
				i += 2;
				tagLength = 0;
				if (i + extLength > length) {
					return false;
				}
				for (var j = 0; j < extLength; j++) {
					tagLength = (tagLength << 8) | buffer.getByteAt(i+j); 
				}
				i += extLength;
			} else {
				// it's a standard tag
				tagLength = (chr << 8) | buffer.getByteAt(i+1);
				i += 2;
			}

			if (i + tagLength > length) {
				return false;
			} else {
				tagName = ExifReader.Tags.iptc[key];
				if (tagName) {

					value = '';
					for (var j = 0; j < tagLength; j++) {
						chr = buffer.getByteAt(i+j);
						if (chr) {
							value += String.fromCharCode(chr);
						}
					}

					// assume string but convert to array when multiple markers found for the same tag
					if (!iptc[tagName]) {
						iptc[tagName] = value;
					} else {
						if (typeof iptc[tagName] == 'string') {
							iptc[tagName] = [iptc[tagName]];
						}
						iptc[tagName].push(value);
					}
				}
				i += tagLength;
			}
		}
	};

	/**
	 * Extract data from an IFD block, and return the offset to the next block.
	 *
	 * @param {Object} metadata
	 * @param {Buffer} buffer
	 * @param {Number} offset
	 * @param {String} tagtype (optional)
	 * @return {Number}
	 */
	function ifd(metadata, buffer, offset, tagType) {
		
		// get the number of directories in this IFD block
		var subDirs = buffer.getShortAt(offset),
			length = buffer.length(),
			subBlockLength = 12;
		
		if (!subDirs) {
			throw new Error(ExifReader.Errors[7]);
		}
			
		// advance past the directory count, loop through the directories, capturing 12-byte buffers
		offset += 2;
		for (var i = 0; i < subDirs; i++) {
			if (offset + subBlockLength <= length) {
				tag(metadata, buffer, offset, tagType || 'exif');
				offset += subBlockLength;
			}
		}
		
		// the last 4 bytes is the offset to the next IFD block
		return buffer.getLongAt(offset);
	};

	/**
	 * Extract the value for a tag.
	 *
	 * @param {Object} metadata
	 * @param {Buffer} buffer
	 * @param {Number} offset
	 * @param {String} tagType
	 */
	function tag(metadata, buffer, offset, tagType) {
		
		// Each tag is 12 bytes, containing:
		// tag number = bytes 0-1
		// data format = bytes 2-3
		// num. components = bytes 4-7 
		// data / data offset = bytes 8-11
		
		var tagNumber = buffer.getShortAt(offset),
			tagName = ExifReader.Tags[tagType][tagNumber],
			fn = dataFormaters[dataFormats[buffer.getShortAt(offset + 2)]],
			value;

		if (fn) {
			value = fn(buffer, offset, buffer.getLongAt(offset + 4));
			
			if (tagNumber == 0x8769) {			// offset to Exif SubIFD
				ifd(metadata, buffer, value * 1);
			} else if (tagNumber == 0x8825) {		// offset to GPS IFD
				ifd(metadata, buffer, value * 1, 'gps');
			} else if (tagName) {
				metadata[tagType][tagName] = value;
			}
		}
	}

	var dataFormats = [,
		'UByte','String','UShort','ULong','URational','SByte','UByte','SShort','SLong','SRational','SFloat','DFloat'
	];

	var dataFormaters = {
		'String': function (buffer, offset, components) {
			var value = '',
				dataOffset, chr;
				
			if (components <= 4) {
				// the value is stored in the lst 4 bytes
				for (var i = 8 ; i <= 11 ; i++) {
					chr = buffer.getByteAt(offset+i);
					if (chr) {
						value += String.fromCharCode(chr);
					}
				}
			} else {
				// the value refers to an offset where the data resides
				dataOffset = buffer.getLongAt(offset + 8);
				if (dataOffset + components > buffer.length()) {
					return;
				} else {
					for (var i = dataOffset; i < dataOffset + 1 * components; i++) {
						chr = buffer.getByteAt(i);
						if (chr) {
							value += String.fromCharCode(chr);
						}
					}
				}
			}
			return value;
		},
			
		'UShort' : function (buffer, offset, components) {
			var value, dataOffset, chr;
			if (components == 1) {
				value = buffer.getShortAt(offset + 8);
			} else if (components == 2) {
				value = [buffer.getShortAt(offset + 8), buffer.getShortAt(offset + 10)];
			}
			return value;
		},
			
		'ULong' : function (buffer, offset, components) {
			var dataOffset = buffer.getLongAt(offset + 8),
				value = [], chr;
			if (components == 1) {
				value = [dataOffset];
			} else {
				for (var i = 0; i < components; i++) {
					value.push(buffer.getLongAt(dataOffset));
					dataOffset += 4;
				}
			}
			return value.join(',');
		},

		'URational' : function (buffer, offset, components) {
			var dataOffset = buffer.getLongAt(offset + 8),
				value = [],
				numerator, denominator;
			
			for (var i = 0; i < components; i++) {
				numerator = buffer.getLongAt(dataOffset);
				denominator = buffer.getLongAt(dataOffset + 4);
				value.push(numerator + '/' + denominator);
				dataOffset += 8;
			}	
			return value.join(',');
		}
	};

	// Some error codes
	ExifReader.Errors = {
		'1'		:	"File is not a valid JPEG",
		'2'		:	"EXIF data too short",
		'3'		:	"IFD data too short",
		'4'		:	"Invalid byte order",
		'5'		:	"Invalid byte order marker",
		'6'		:	"Invalid IFD0 offset",
		'7'		:	"Couldn't find subdirectories in IFD",
		'8'		:	"Data offset error"
	};

	// Default tags that may be parsed
	ExifReader.Tags = {
		exif : {
			0x0100 : 'ImageWidth',
			0x0101 : 'ImageHeight',
			0x010f : 'Make',
			0x0110 : 'Model',
			0x0112 : 'Orientation',
			0x0131 : 'Software',
			0x0132 : 'ModifyDate',
			0x013b : 'Artist',
			0x829a : 'ExposureTime',
			0x829d : 'FNumber',
			0x8827 : 'ISO',
			0x9003 : 'DateTimeOriginal',
			0x9004 : 'DateTimeDigitized',
			0x920a : 'FocalLength',
			0xa001 : 'ColorSpace',
			0xa002 : 'PixelXDimension',
			0xa003 : 'PixelYDimension',
			0xa430 : 'CameraOwnerName',
			0xa431 : 'BodySerialNumber',
			0xa433 : 'LensMake',
			0xa434 : 'LensModel',
			0xa435 : 'LensSerialModel',
			0x0103 : 'Compression',
			0x0201 : 'ThumbnailOffset',
			0x0202 : 'ThumbnailSize'
		},
		gps : {
			0x0001 : 'GPSLatitudeRef',
			0x0002 : 'GPSLatitude',
			0x0003 : 'GPSLongitudeRef',
			0x0004 : 'GPSLongitude',
			0x0005 : "GPSAltitudeRef",
			0x0006 : "GPSAltitude"
		},
		iptc : {
			'2x105' : 'Headline',
			'2x120' : 'Description',
			'2x25' : 'Keywords'
		}
	};

	// ! JpegReader

	/**
	* The JpegReader class is a high-level class providing access to a JPEG's metadata.
	**/

	/**
	 * Constructor
	 *
	 * @param {Object} config {workerUrl : {String|null}}
	 */
	var JpegReader = build(function(config) {

		this.config = config || {};

		this.onload = null;
		this.onerror = null;
		this.onloadpreview = null;

		this.binary = null;
		this.preview = null;
		this.metadata = {};

		this.error = null;
		this.readyState = JpegReader.EMPTY;
	}, {

		/**
		 * Return a data URL for the JPEG.
		 *
		 * @return {String|null}
		 */
		dataURL : function() {
			return this.binary ? ('data:image/jpeg;base64,' + btoa(this.binary)) : null;
		},

		/**
		 * Return a data URL for the JPEG's thumbnail.
		 *
		 * @return {String|null}
		 */
		thumbnailDataURL : function() {
			return this.metadata.thumbnail ? ('data:image/jpeg;base64,' + btoa(this.metadata.thumbnail)) : null;
		},

		/**
		 * Load a file.
		 *
		 * @param {File} file
		 * @return void
		 */
		load : function(file) {
			if (file.type.match(/^image\/p?jpe?g$/)) {
				if (this.readyState === JpegReader.EMPTY) {
					this.readyState = JpegReader.LOADING;

					var self = this;

					var onloadend = function(response) {
						self.readyState = JpegReader.DONE;
						self.error = response.error;
						self.binary = response.result;
						if (self.error) {
							if (reader.onerror) {
								reader.onerror(new JpegReaderErrorEvent(self));
							}
						} else {
							var exifReader = new ExifReader;
							exifReader.process(self.binary);
							self.metadata = exifReader.metadata;

							if (self.onload) {
								self.onload(new JpegReaderLoadEvent(self));
							}
						}
					};

					if (window.Worker && this.config.workerUrl) {
						var worker = new Worker(this.config.workerUrl);
						worker.addEventListener('message', function(e) {
							onloadend(e.data);
						}, false);
						worker.postMessage(file);
					} else {
						readFile(file, onloadend, false);
					}
				}
			} else {
				errorHandler(this, new Error('File is not a JPEG'));
			}
		},

		/**
		 * Load a square preview of the JPEG.
		 *
		 * @param {Number} edge
		 * @return void
		 */
		loadPreview : function(edge) {
			edge = edge || 100;

			// By default, create the source from the embedded EXIF thumbnail.
			var source = new Image,
				self = this,
				dataURL = this.thumbnailDataURL(),
				orientation = 1;

			// If there was no thumbnail embedded, use the full image as the source.
			if (!dataURL) {
				dataURL = this.dataURL();
				orientation = this.metadata.exif.Orientation || 1;
			}

			source.onload = function() {

				var canvas = document.createElement('canvas'),
					degrees = [0, 0, 0, 180, 0, 0, 90, 0, -90][orientation],
					x, y, w;

				if (source.width > source.height) {
					x = Math.floor((source.width - source.height) / 2);
					y = 0;
					w = source.height;
				} else {
					x = 0
					y = Math.floor((source.height - source.width) / 2);
					w = source.width;
				}
				
				canvas.width = edge;
				canvas.height = edge;
				var context = canvas.getContext('2d');
				if (degrees) {
					// This is much easier since the preview is always square.
					context.translate(edge / 2, edge / 2);
					context.rotate(degrees * Math.PI / 180);
					context.translate(-edge / 2, -edge / 2);
				};
				context.drawImage(source, x, y, w, w, 0, 0, edge, edge);
				
				self.preview = canvas.toDataURL('image/jpeg');
				if (self.onloadpreview) {
					self.onloadpreview(new JpegReaderLoadPreviewEvent(self));
				}
			};
			source.src = dataURL;
		}
	});

	// State constants
	JpegReader.EMPTY = 0;
	JpegReader.LOADING = 1;
	JpegReader.DONE = 2;

	// Shared handlers
	var errorHandler = function(self, e) {
		self.error = e;
		if (self.onerror) {
			self.onerror(e);
		}
	};

	var JpegReaderLoadEvent = function(target) {
		this.type = 'load';
		this.target = target;
	};

	var JpegReaderErrorEvent = function(target) {
		this.type = 'error';
		this.target = target;
	};

	var JpegReaderLoadPreviewEvent = function(target) {
		this.type = 'loadpreview';
		this.target = target;
	};

	/**
	 * Perform file read using method based on worker environment.
	 *
	 * @param {File} file
	 * @param {Function} callback
	 * @param {Boolean} asWorker
	 * @return void
	 */
	var readFile = function(file, callback, asWorker) {
		if (asWorker && self.FileReaderSync) {
			var reader = new FileReaderSync,
				result, error;
			try {
				result = reader.readAsBinaryString(file);
			} catch (e) {
				error = e.message;
			}
			callback({
				result : result,
				error : error
			});
		} else {
			var reader = new FileReader;
			reader.onloadend = function() {
				callback({
					result : reader.result,
					error : reader.error
				});
			};
			reader.readAsBinaryString(file);
		}
	};

	// Setup for running inside Worker.
	if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
		self.addEventListener('message', function(e) {
			readFile(e.data, function(response) {
				self.postMessage(response);
			}, true);
		}, false);
	}

	return {
		ExifReader : ExifReader,
		JpegReader : JpegReader
	};
});
