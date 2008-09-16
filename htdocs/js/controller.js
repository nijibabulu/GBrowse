/*
 controller.js -- The GBrowse controller object

 Lincoln Stein <lincoln.stein@gmail.com>
 $Id: controller.js,v 1.47 2008-09-16 17:34:03 mwz444 Exp $

Indentation courtesy of Emacs javascript-mode 
(http://mihai.bazon.net/projects/emacs-javascript-mode/javascript.el)

Method structure
 - Class Utility Methods
 - DOM Utility Methods
 - Update Section Methods
 - Kick-off Render Methods
 - Retrieve Rendered Track Methods
 - Track Configure Methods
 - Plugin Methods
 - Upload File Methods

*/

//  Element Names
var track_listing_id        = 'tracks_panel'; 
var external_listing_id     = 'upload_tracks_panel'; 
var overview_container_id   = 'overview_panels'; 
var region_container_id     = 'region_panels'; 
var detail_container_id     = 'detail_panels'; 
var external_utility_div_id = 'external_utility_div'; 
var edit_upload_form_id     = 'edit_upload_form';
var page_title_id           = 'page_title';
var visible_span_id         = 'span';

var GBrowseController = Class.create({

  // Class Utility Methods ******************************************
  
  initialize:
  function () {
    // periodic_updaters contains all the updaters for each track
    this.periodic_updaters        = new Array();
    this.gbtracks                 = new Hash();
    this.segment_observers        = new Hash();
    this.retrieve_tracks          = new Hash();
    this.track_time_key           = new Hash();
    // segment_info holds the information used in rubber.js
    this.segment_info;
  },

  reset_after_track_load:
  // This may be a little overkill to run these after every track update but
  // since there is no "We're completely done with all the track updates for the
  // moment" hook, I don't know of another way to make sure the tracks become
  // draggable again
  function () {
    if ( null != $(overview_container_id) ){
      create_drag(overview_container_id,'track');
    }
    if ( null != $(region_container_id) ){
      create_drag(region_container_id,'track');
    }
    if ( null != $(detail_container_id) ){
      create_drag(detail_container_id,'track');
    }
  },
  
  register_track:
  function (track_name,track_type) {
    
    var gbtrack = new GBrowseTrack(track_name,track_type); 
    this.gbtracks.set(track_name,gbtrack);
    if (track_type=="scale_bar"){
      return;
    }
    this.retrieve_tracks.set(gbtrack.track_div_id,true);
  }, // end register_track

  // DOM Utility Methods ********************************************

  wipe_div:
  function(div_id) {
    $(div_id).innerHTML = '';
  },

  update_scale_bar:
  function (bar_obj) {
    var image_id = bar_obj.image_id;
    var image = $(image_id);
    image.setStyle({
        background: "url(" + bar_obj.url + ") top left no-repeat",
        width:      bar_obj.width+'px',
        height:     bar_obj.height+'px',
        display:    'block',
        cursor:     'text',
    });
    image.setOpacity(1);
  },

  append_child_from_html:
  function (child_html,parent_obj) {
    //Append new html to the appropriate section This is a bit cludgy but we
    //create a temp element, read the html into it and then move the div
    //element back out.  This keeps the other tracks intact.
    var tmp_element       = document.createElement("tmp_element");
    tmp_element.innerHTML = child_html;
    parent_obj.appendChild(tmp_element);

    // Move each child node but skip if it is a comment (class is undef)
    if (tmp_element.hasChildNodes()) {
      var children = tmp_element.childNodes;
      for (var i = 0; i < children.length; i++) {
        if (children[i].className == undefined){
          continue;
        }
        parent_obj.appendChild(children[i]);
      };
    };
    parent_obj.removeChild(tmp_element);
  },

  // Update Section Methods *****************************************
  update_sections:
  function(section_names, param_str) {

    var request_str = "update_sections=1" + param_str;
    for (var i = 0; i < section_names.length; i++) {
      request_str += "&section_names="+section_names[i];
    }
    new Ajax.Request('#',{
      method:     'post',
      parameters: request_str,
      onSuccess: function(transport) {
        var results    = transport.responseJSON;
        var section_html = results.section_html;
        for (var section_name in section_html){
          html    = section_html[section_name];
          $(section_name).innerHTML = html;
        }
      }
    });
  },

  // Signal Change to Server Methods ********************************
  set_track_visibility:
  function(track_name,visible) {

    if ( null == $('track_'+track_name)){
      // No track div
      return;
    }

    new Ajax.Request('#',{
      method:     'post',
      parameters: {
        set_track_visibility:  1,
        visible:               visible,
        track_name:            track_name,
      },
    });
  },

  // Kick-off Render Methods ****************************************

  first_render:
  function()  {
    new Ajax.Request('#',{
      method:     'post',
      parameters: {first_render: 1},
      onSuccess: function(transport) {
        var results    = transport.responseJSON;
        var track_keys = results.track_keys;
        Controller.segment_info = results.segment_info;

        Controller.get_multiple_tracks(track_keys);
      }
    });
  },

  update_coordinates:
  function (action) {

    // submit search form if the detail panel doesn't exist
    if ( null == $(detail_container_id) ){
        document.searchform.force_submit.value = 1; 
        document.searchform.submit(); 
    }

    //Grey out image
    this.gbtracks.values().each(
      function(gbtrack) {
	    $(gbtrack.track_image_id).setOpacity(0.3);
      }
    );
    
    new Ajax.Request('#',{
      method:     'post',
      parameters: {navigate: action},
      onSuccess: function(transport) {
	    var results                 = transport.responseJSON;
        Controller.segment_info     = results.segment_info;
	    var track_keys              = results.track_keys;
	    var overview_scale_bar_hash = results.overview_scale_bar;
	    var region_scale_bar_hash   = results.region_scale_bar;
	    var detail_scale_bar_hash   = results.detail_scale_bar;
    
        if (overview_scale_bar_hash){
          Controller.update_scale_bar(overview_scale_bar_hash);
        }
        if (region_scale_bar_hash){
          Controller.update_scale_bar(region_scale_bar_hash);
        }
        if (detail_scale_bar_hash){
          Controller.update_scale_bar(detail_scale_bar_hash);
        }
    
        // Update the segment sections
        Controller.update_sections( Controller.segment_observers.keys());

        Controller.get_multiple_tracks(track_keys);
      } // end onSuccess
      
    }); // end Ajax.Request
  }, // end update_coordinates

  add_track:
  function(track_name) {

    if ( null != $('track_'+track_name)){
      return;
    }

    new Ajax.Request('#',{
      method:     'post',
      parameters: {
        add_track:  1,
        track_name: track_name,
      },
      onSuccess: function(transport) {
        var results    = transport.responseJSON;
        var track_data = results.track_data;
        for (var key in track_data){
          this_track_data    = track_data[key];
          var div_element_id = this_track_data.div_element_id;
          var html           = this_track_data.track_html;
          var panel_id       = this_track_data.panel_id;

          Controller.append_child_from_html(html,$(panel_id));

          //Add New Track(s) to the list of observers and such
          Controller.register_track(track_name,'standard') ;

          if (html.substring(0,18) == "<!-- AVAILABLE -->"){
            Controller.reset_after_track_load();
          }
          else{
            var track_keys = new Array();
            time_key = create_time_key();
            track_keys[div_element_id]=this_track_data.track_key;
            Controller.retrieve_tracks.set(div_element_id,true);
            Controller.track_time_key.set(div_element_id,time_key);
            Controller.get_remaining_tracks(track_keys,1000,1.5,time_key);
          }
        }
      },
    });
  },

  rerender_track:
  function(track_name,track_div_id) {

    var gbtrack = this.gbtracks.get(track_name);
    $(gbtrack.track_image_id).setOpacity(0.3);

    new Ajax.Request('#',{
      method:     'post',
      parameters: {
        rerender_track:  1,
        track_name: track_name,
      },
      onSuccess: function(transport) {
        var results    = transport.responseJSON;
        var track_keys = results.track_keys;
        time_key = create_time_key();
        for (var track_div_id in track_keys){
            Controller.retrieve_tracks.set(track_div_id,true);
            Controller.track_time_key.set(track_div_id,time_key);
        } // end for
        Controller.get_remaining_tracks(track_keys,1000,1.5,time_key);
      }, // end onSuccess
    }); // end Ajax.Request
  }, // end rerender_track

  // Retrieve Rendered Track Methods ********************************
  
  get_multiple_tracks:
  function (track_keys) {
    
    time_key = create_time_key();
    this.retrieve_tracks.keys().each(
      function(track_div_id) {
        Controller.retrieve_tracks.set(track_div_id,true);
        Controller.track_time_key.set(track_div_id,time_key);
      }
    );

    this.get_remaining_tracks(track_keys,1000,1.5,time_key);
  },

  // Time key is there to make sure separate calls don't trounce each other
  // Only Update if the tracks time_key matches the method's
  get_remaining_tracks:
  function (track_keys,time_out,decay,time_key){

    var track_div_ids = [];
    var finished = true;
    var track_key_str = '';
    this.retrieve_tracks.keys().each(
      function(track_div_id) {
        if(Controller.retrieve_tracks.get(track_div_id)){
          if (Controller.track_time_key.get(track_div_id) == time_key){
            track_div_ids.push(track_div_id);
            track_key_str += '&tk_'+escape(track_div_id)+"="+track_keys[track_div_id];
            finished = false;
          }
        }
      }
    );

    if (finished){
      return;
    }

    new Ajax.Request('#',{
      method:     'post',
      parameters: $H({ retrieve_multiple: 1, 
                       track_div_ids:     track_div_ids, 
		    }).toQueryString()  + track_key_str,
      onSuccess: function(transport) {
        var continue_requesting = false;
        var results    = transport.responseJSON;
        var track_html_hash = results.track_html;
        for (var track_div_id in track_html_hash){
          track_html    = track_html_hash[track_div_id];

          if (Controller.track_time_key.get(track_div_id) == time_key){
            track_div = document.getElementById(track_div_id);
            if (track_html.substring(0,18) == "<!-- AVAILABLE -->"){
              track_div.innerHTML = track_html;
              Controller.retrieve_tracks.set(track_div_id,false);
            }
            else if (track_html.substring(0,16) == "<!-- EXPIRED -->"){
               $(this.track_image_id[track_div_id]).setOpacity(0);
            }
            else {
              continue_requesting = true;
            }
          }
        }
        Controller.reset_after_track_load();
        if (continue_requesting){
          setTimeout( function() {
            Controller.get_remaining_tracks(track_keys,time_out*decay,decay,time_key)
          } ,time_out);
        }
      }, // end onSuccess
    }); // end new Ajax.Request

  }, // end get_remaining_tracks

  // Track Configure Methods ****************************************

  reconfigure_track:
  function(track_name, serialized_form, show_track) {
    new Ajax.Request('#',{
      method:     'post',
      parameters: serialized_form +"&"+ $H({
            reconfigure_track: track_name
          }).toQueryString(),
      onSuccess: function(transport) {
        var track_div_id = "track_"+track_name;
        Balloon.prototype.hideTooltip(1);
        if (show_track){
          Controller.rerender_track(track_name,track_div_id);
        }
        else{
          if ($(track_div_id) != null){
            // Don't know why I need to remove this twice, but I do.
            // The second remove seems to actually remove it from the DOM.
            $(track_div_id).remove();
            $(track_div_id).remove();
          }
          Controller.update_sections(new Array(track_listing_id));
        }
      } // end onSuccess
    });

  },


  // Plugin Methods *************************************************

  configure_plugin:
  function(div_id) {
    var plugin_base  = document.pluginform.plugin.value;
    Controller.update_sections(new Array(div_id), '&plugin_base='+plugin_base);
  },

  reconfigure_plugin:
  function(plugin_action,plugin_track_name,plugin_track_div_id,pc_div_id,plugin_type) {
    var form_element = $("configure_plugin");
    new Ajax.Request('#',{
      method:     'post',
      parameters: form_element.serialize() +"&"+ $H({
            plugin_action: plugin_action,
            reconfigure_plugin: 1
          }).toQueryString(),
      onSuccess: function(transport) {
        Controller.wipe_div(pc_div_id); 

        if (plugin_type == 'annotator'){
          // update plugin track if it exists
          if ( null != $(plugin_track_div_id)){
            Controller.rerender_track(plugin_track_name,plugin_track_div_id);
          }
        }
        else if (plugin_type == 'filter'){
          Controller.update_coordinates("reload segment");
        }
      } // end onSuccess
    });
  },

  plugin_go:
  function(plugin_base,plugin_type,plugin_action,source) {
    if (plugin_type == 'annotator'){
      var select_box = document.pluginform.plugin;
      var track_name = select_box.options[select_box.selectedIndex].attributes.getNamedItem('track_name').value;

      this.add_track(track_name);
      // NEEDS TO CHECK THE TRACK CHECKBOX
    }
    else if (plugin_type == 'dumper'){
      var loc_str = "?plugin="+plugin_base+";plugin_action="+encodeURI(plugin_action);
      if(source == 'config'){
        var form_element = $("configure_plugin");
        window.location=loc_str + ";" + form_element.serialize();
      }
      else{
        window.location=loc_str;
      }
    }
    else if (plugin_type == 'filter'){
      // Go doesn't do anything for filter
      return false; 
    }
    else if (plugin_type == 'finder'){
        alert("Not Implemented Yet");
    }
  }, // end plugin_go

  // Upload File Methods *************************************************

  edit_new_file:
  function() {
    Controller.update_sections(new Array(external_utility_div_id), '&new_edit_file=1');
  },

  edit_upload:
  function(edit_file) {
    Controller.update_sections(new Array(external_utility_div_id), '&edit_file='+edit_file);
  },

  commit_file_edit:
  function(edited_file,track_name,track_div_id) {
    var form_element = $(edit_upload_form_id);
    new Ajax.Request('#',{
      method:     'post',
      parameters: form_element.serialize() +"&"+ $H({
            edited_file: edited_file,
            commit_file_edit: 1
          }).toQueryString(),
      onSuccess: function(transport) {
        var results    = transport.responseJSON;
        var file_created = results.file_created;
        Controller.wipe_div(external_utility_div_id); 

        if ( 1 == file_created ){
          Controller.add_track(track_name);
          Controller.update_sections(new Array(track_listing_id,external_listing_id));
        }
        else{
        // update track if it exists
          if ( null != $(track_div_id)){
            Controller.rerender_track(track_name,track_div_id);
          }
          Controller.update_sections(new Array(external_listing_id));
        }
      } // end onSuccess
    });
  },

  delete_upload_file:
  function(file_name,track_div_id) {
    new Ajax.Request('#',{
      method:     'post',
      parameters: {
        delete_upload_file: 1,
        file: file_name
      },
      onSuccess: function(transport) {
        $(track_div_id).remove();
        Controller.update_sections(new Array(track_listing_id,external_listing_id));
      } // end onSuccess
    });
  },


});

var Controller = new GBrowseController; // singleton

function initialize_page() {
  //event handlers
  [page_title_id,visible_span_id].each(function(el) {
    if ($(el) != null) {
      Controller.segment_observers.set(el,1);
    }
  });
  
  Controller.first_render();
  Overview.prototype.initialize();
  Region.prototype.initialize();
  Details.prototype.initialize();
}

function create_time_key () {
    time_obj = new Date();
    return time_obj.getTime();
}

